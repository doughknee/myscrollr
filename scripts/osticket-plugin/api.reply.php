<?php
/**
 * ScrollrReplyController — handles POST /api/tickets/{number}/reply.json
 *
 * This is the only endpoint this plugin exposes. The dispatcher in
 * class.ScrollrReplyPlugin.php captures {number} from the URL and
 * passes it as `$args` to reply(); the JSON body is read from the
 * standard ApiController helpers.
 *
 * Request body (JSON):
 *   {
 *     "reply_html":   "<p>...</p>",         // required, body of the reply
 *     "staff_id":     1,                    // optional, the agent posting
 *     "staff_email":  "support@...",        // optional, alternative to staff_id
 *     "signal_alert": true,                 // optional, default true — send user notification
 *     "claim":        false,                // optional, default false — assign ticket to staff
 *     "title":        "Re: subject",        // optional, override the subject
 *     "close_ticket": false                 // optional, default false — close ticket after reply
 *   }
 *
 * One of {staff_id, staff_email} must resolve to a valid staff agent.
 * The reply will be attributed to that agent in the thread history,
 * and the outbound notification email's From: will be the department's
 * reply-from address (per Dept::getReplyEmail()).
 *
 * Response on success (200):
 *   {
 *     "status":          "ok",
 *     "ticket_number":   "239171",
 *     "ticket_id":       1247,
 *     "entry_id":        45822,
 *     "alert_sent":      true,
 *     "staff_id":        1,
 *     "staff_name":      "Support",
 *     "close_requested": false,
 *     "closed":          false
 *   }
 *
 * When close_ticket=true is requested but the close fails (no closed
 * status configured, etc.), the reply still succeeds and the response
 * includes "close_error": "<reason>" so the caller knows.
 *
 * Response on failure (4xx/5xx) is the standard osTicket ApiController
 * error envelope: { "error": "message" } with appropriate status.
 *
 * The endpoint is auth'd by X-API-Key (requireApiKey enforces both the
 * key validity AND the IP-binding on the api key row). No additional
 * signing — same threat model as the existing ticket-create endpoint.
 */

require_once INCLUDE_DIR . 'class.api.php';
require_once INCLUDE_DIR . 'class.ticket.php';
require_once INCLUDE_DIR . 'class.staff.php';

class ScrollrReplyController extends ApiController {

    /**
     * Map a request format to the JSON content-type the dispatcher
     * routes. We only accept JSON for now.
     */
    function getRequestStructure($format, $data = null) {
        $supported = array(
            'reply_html', 'staff_id', 'staff_email', 'signal_alert',
            'claim', 'title', 'close_ticket',
        );

        if ($format !== 'json') {
            return null;
        }

        return $supported;
    }

    /**
     * Validate inbound JSON shape.
     */
    function validate(&$data, $format, $strict = true) {
        if (!isset($data['reply_html']) || !is_string($data['reply_html'])
                || trim($data['reply_html']) === '') {
            $this->exerr(400, __('reply_html is required and must be a non-empty string'));
        }
        // Bound the body to avoid abusing this as a denial-of-service
        // vector. osTicket itself will further validate via its
        // ResponseForm, but a quick guard at the entry point is cheap.
        if (strlen($data['reply_html']) > 65536) {
            $this->exerr(413, __('reply_html exceeds 65536 bytes'));
        }
    }

    /**
     * Endpoint handler. URL pattern in the dispatcher captures {number}
     * which is delivered through $args by the framework.
     */
    function reply($number) {
        // 1. Auth — same as TicketApiController::create. Validates
        //    X-API-Key header AND the api key's bound IP. 401 on either
        //    failure.
        $key = $this->requireApiKey();
        if (!$key->canCreateTickets()) {
            // Reusing the create-tickets capability flag; rationale: a
            // key that can post agent replies should already be
            // sufficiently trusted to create tickets too. If you want a
            // separate flag, add one to ost_api_key and check it here.
            return $this->exerr(403, __('API key not authorised to post replies'));
        }

        // 2. Parse + validate JSON body.
        $data = $this->getRequest('json');
        $this->validate($data, 'json');

        // 3. Look up the ticket by number from the URL.
        // osTicket's UrlMatcher::dispatch strips named captures and passes
        // remaining captures as positional args via call_user_func_array,
        // so $number is the bare ticket-number string from the URL.
        if (!is_string($number) || !preg_match('/^[\w-]+$/', $number)) {
            return $this->exerr(400, __('Invalid ticket number in URL'));
        }
        $ticket = Ticket::lookupByNumber($number);
        if (!$ticket) {
            return $this->exerr(404, __('Ticket not found'));
        }

        // 4. Resolve the staff agent who's posting the reply.
        $staff = $this->resolveStaff($data, $ticket);
        if (!$staff) {
            return $this->exerr(400, __('Could not resolve staff agent (provide staff_id or staff_email)'));
        }

        // 5. Build the reply payload in the shape Ticket::postReply()
        //    expects. This mirrors what the agent web UI submits when
        //    an agent fills the reply form on a ticket page.
        $vars = array(
            'response'    => $data['reply_html'],
            'reply-to'    => 'all',  // notify owner + collaborators by default
            'ticket_id'   => $ticket->getId(),
            'staffId'     => $staff->getId(),
            'poster'      => $staff,
            'cannedattachments' => array(),
            'attachments' => array(),
            // Optional: override the outbound email subject
            'title'       => isset($data['title']) ? (string) $data['title'] : null,
        );

        // Optional behaviours
        $alert = !isset($data['signal_alert']) || (bool) $data['signal_alert'];
        $claim = isset($data['claim']) && (bool) $data['claim'];
        if ($claim) {
            // Assigning before reply mimics agent UI's "claim on response"
            // workflow. Not required for the reply itself.
            $form = new \AssignmentForm(array(), array());
            $form->setStaffId($staff->getId());
            $errors = array();
            $ticket->assign($form, $errors);
            // Assignment errors are non-fatal — log and continue.
            if ($errors) {
                $this->logWarning('scrollr-reply-api: assignment failed', $errors);
            }
        }

        // 6. Dispatch the reply through Ticket::postReply().
        //    This is the SAME method the agent web UI invokes when an
        //    agent clicks "Submit Reply" on the ticket page. It:
        //      - Calls $ticket->getThread()->addResponse($vars, $errors)
        //        which creates a ResponseThreadEntry (type='R')
        //      - Sends the user notification via $dept->getReplyEmail()
        //        if $alert is truthy and the dept's autoresponder
        //        settings allow it
        //      - Fires Signal::send('thread.response.posted', $entry)
        //      - Updates ost_ticket.lastupdate, isanswered=1, optionally
        //        clears overdue flag, etc.
        $errors = array();
        $entry = $ticket->postReply($vars, $errors, $alert);

        if (!$entry) {
            $errMsg = $errors ? implode('; ', array_map('strval', $errors)) : __('postReply returned null without explicit errors');
            return $this->exerr(500, sprintf(__('Failed to post reply: %s'), $errMsg));
        }

        // 7. Optional auto-close. When close_ticket=true, flip the
        //    ticket to its configured "closed" status. The reply has
        //    already posted at this point so a close-failure is
        //    non-fatal; we report it back to the caller in the
        //    response payload as close_status without erroring.
        $closeRequested = isset($data['close_ticket']) && (bool) $data['close_ticket'];
        $closed = false;
        $closeError = null;
        if ($closeRequested) {
            list($closed, $closeError) = $this->closeTicket($ticket, $staff);
            if (!$closed) {
                $this->logWarning(sprintf(
                    'scrollr-reply-api: close_ticket=true requested but close failed for ticket=%s: %s',
                    $ticket->getNumber(),
                    $closeError ?: 'unknown error'
                ));
            }
        }

        // 8. Success.
        $payload = array(
            'status'         => 'ok',
            'ticket_number'  => $ticket->getNumber(),
            'ticket_id'      => $ticket->getId(),
            'entry_id'       => method_exists($entry, 'getId') ? $entry->getId() : null,
            'alert_sent'     => $alert,
            'staff_id'       => $staff->getId(),
            'staff_name'     => $staff->getName()->asVar(),
            'close_requested'=> $closeRequested,
            'closed'         => $closed,
        );
        if ($closeRequested && !$closed && $closeError) {
            $payload['close_error'] = $closeError;
        }

        $this->response(200, json_encode($payload), 'application/json');
    }

    /**
     * Close the ticket via the same path the agent UI uses.
     *
     * Strategy: look up the configured "closed" status by name (the
     * built-in default in tiredofit/osticket is named "Closed"; some
     * installs add custom closed statuses but we always go for the
     * canonical one first). Then call $ticket->setStatus($status,
     * $reason, $errors) — this is the same method the agent web UI
     * uses on the close action. It updates ost_ticket.status_id +
     * closed/lastupdate timestamps, fires Signal::send for any
     * listeners, and skips outbound notifications (we already sent
     * the reply notification on this same call).
     *
     * Returns array($closed_bool, $error_msg_or_null).
     */
    private function closeTicket($ticket, $staff) {
        // 1. Locate the closed status. TicketStatus::lookup accepts
        //    either an id or a name keyword.
        $status = TicketStatus::lookup(array('name' => 'Closed'));
        if (!$status) {
            // Fall back: scan for the first status flagged as closed-state.
            $list = TicketStatusList::load();
            if ($list && method_exists($list, 'getItems')) {
                foreach ($list->getItems() as $s) {
                    if (method_exists($s, 'getState') && $s->getState() === 'closed') {
                        $status = $s;
                        break;
                    }
                }
            }
        }
        if (!$status) {
            return array(false, 'No closed-state ticket status found in this osTicket install');
        }

        // 2. Apply. setStatus persists immediately and fires signals.
        //    Some osTicket versions take ($status, $reason, &$errors);
        //    others take ($status_id, &$errors). We try the modern
        //    signature first.
        $errors = array();
        $reason = 'Auto-closed via Scrollr Reply API after partner-approved resolution reply';
        try {
            $ok = $ticket->setStatus($status, $reason, $errors);
        } catch (Exception $e) {
            return array(false, 'setStatus exception: ' . $e->getMessage());
        }

        if (!$ok) {
            $msg = !empty($errors) ? implode('; ', array_map('strval', $errors)) : 'setStatus returned false';
            return array(false, $msg);
        }
        return array(true, null);
    }

    /**
     * Resolve the staff agent who posts the reply.
     *
     * Priority:
     *   1. data['staff_id']    — direct lookup by id
     *   2. data['staff_email'] — lookup by email (Staff::getIdByEmail)
     *   3. ticket's currently-assigned staff — fallback if unspecified
     *
     * Returns Staff object or null.
     */
    private function resolveStaff($data, $ticket) {
        if (!empty($data['staff_id']) && is_numeric($data['staff_id'])) {
            $s = Staff::lookup((int) $data['staff_id']);
            if ($s) {
                return $s;
            }
        }
        if (!empty($data['staff_email']) && is_string($data['staff_email'])) {
            $sid = Staff::getIdByEmail($data['staff_email']);
            if ($sid) {
                $s = Staff::lookup($sid);
                if ($s) {
                    return $s;
                }
            }
        }
        // Fallback: ticket's current assignee.
        $assigned = $ticket->getStaff();
        if ($assigned) {
            return $assigned;
        }
        return null;
    }

    /**
     * Lightweight logger; uses osTicket's global logger if available.
     */
    private function logWarning($msg, $context = null) {
        global $ost;
        if ($ost && method_exists($ost, 'logWarning')) {
            $body = $context ? $msg . "\n\n" . print_r($context, true) : $msg;
            $ost->logWarning('scrollr-reply-api', $body);
        }
    }
}
