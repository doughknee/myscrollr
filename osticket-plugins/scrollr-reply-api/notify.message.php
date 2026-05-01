<?php
/**
 * ScrollrReplyNotify — outbound webhook to the Scrollr core API.
 *
 * Fires when a user posts a new message on an existing ticket so the
 * Scrollr core API can run AI triage on the reply, generate a fresh
 * draft response, and notify the on-call agent for approval.
 *
 * The /support/ticket flow on the Scrollr API already runs AI triage
 * on initial ticket creation. This hook closes the loop for FOLLOW-UP
 * messages (user replies to AI/agent responses) so the conversation
 * doesn't dead-end after the first round.
 *
 * Filters applied here (in order):
 *   1. Skip if entry type is not 'M' (Message — only fire for user
 *      messages, not agent replies or internal notes)
 *   2. Skip if the entry is not on a Ticket (could be a Task)
 *   3. Skip if it's the first message on the thread (the initial
 *      ticket-creation entry — already triaged via /support/ticket
 *      OR was an IMAP-only ticket which we don't auto-triage today)
 *
 * Auth: shared secret in the X-Scrollr-Webhook-Secret header. The
 * core-api side validates with constant-time comparison. The secret
 * comes from the SCROLLR_WEBHOOK_SECRET env var on the osTicket
 * container; if unset, the webhook silently no-ops (so a half-
 * configured deploy doesn't spam errors).
 *
 * Failure mode: webhook is best-effort. If the core API is down or
 * returns 5xx, we log a warning to osTicket's system log and return.
 * The user message is still saved in osTicket as normal — only the
 * AI-triage layer is bypassed for that specific reply.
 */

class ScrollrReplyNotify {

    /**
     * Default endpoint used when SCROLLR_WEBHOOK_URL env var is unset.
     * Override in production via the env var if needed.
     */
    const DEFAULT_WEBHOOK_URL = 'https://api.myscrollr.com/webhooks/osticket/thread-message';

    /**
     * Hard timeout for the webhook POST. Keep this short — if the core
     * API is wedged, we don't want to delay user-message creation in
     * osTicket.
     */
    const WEBHOOK_TIMEOUT_SECONDS = 5;

    /**
     * Notify the Scrollr core API that a user has posted a new message
     * on an existing ticket. Called from the threadentry.created signal
     * in class.ScrollrReplyPlugin.php's bootstrap().
     *
     * @param mixed $entry ThreadEntry-shaped object emitted by osTicket
     */
    public static function notifyUserMessage($entry) {
        if (!$entry || !is_object($entry)) {
            return;
        }

        // 1. Filter to user messages only — type='M'.
        //    'R' = staff Reply, 'N' = internal Note. We don't want
        //    those triggering AI triage.
        if (method_exists($entry, 'getType') && $entry->getType() !== 'M') {
            return;
        }

        // 2. Resolve to thread → ticket. Skip non-ticket objects (Tasks).
        if (!method_exists($entry, 'getThread')) {
            return;
        }
        $thread = $entry->getThread();
        if (!$thread) {
            return;
        }
        if (method_exists($thread, 'getObjectType') && $thread->getObjectType() !== 'T') {
            return;
        }
        $ticket = method_exists($thread, 'getObject') ? $thread->getObject() : null;
        if (!$ticket) {
            return;
        }

        // 3. Skip the FIRST message of a thread. We can't trust
        //    $thread->getNumMessages() — at signal-fire time it
        //    sometimes returns 1 even for a follow-up reply (cached
        //    or just-saved entry not yet counted). Instead, compare
        //    the ticket's creation time to NOW: if the ticket was
        //    created within the last 60 seconds, treat this entry as
        //    the initial message (already handled by /support/ticket).
        //    The 60s window is generous — an actual human won't reply
        //    to their own ticket that fast.
        $ticketCreated = method_exists($ticket, 'getCreateDate') ? $ticket->getCreateDate() : null;
        if ($ticketCreated) {
            $ticketAgeSec = time() - strtotime($ticketCreated);
            if ($ticketAgeSec < 60) {
                // Ticket created less than a minute ago — this is the
                // initial message, already triaged at /support/ticket.
                return;
            }
        }

        // Build payload. Field shape mirrors the /support/ticket
        // request body so the core API can reuse most of the same
        // triage code path with minimal branching.
        $payload = array(
            'event'           => 'thread.message',
            'ticket_number'   => self::safeStringCall($ticket, 'getNumber'),
            'ticket_id'       => self::safeIntCall($ticket, 'getId'),
            'thread_entry_id' => self::safeIntCall($entry, 'getId'),
            'user_email'      => self::safeStringCall($ticket, 'getEmail'),
            'user_name'       => self::extractName($ticket),
            'subject'         => self::safeStringCall($ticket, 'getSubject'),
            'message_html'    => self::extractBody($entry),
            'created'         => self::safeStringCall($entry, 'getCreated'),
        );

        $url = getenv('SCROLLR_WEBHOOK_URL');
        if (!$url) {
            $url = self::DEFAULT_WEBHOOK_URL;
        }
        $secret = getenv('SCROLLR_WEBHOOK_SECRET');
        if (!$secret) {
            // Half-configured deploy — log once but don't spam.
            self::logWarning('SCROLLR_WEBHOOK_SECRET not set; skipping webhook for ticket=' . $payload['ticket_number']);
            return;
        }

        self::postJSON($url, $secret, $payload);
    }

    /**
     * isFirstMessage returns true when $entry is the FIRST user
     * message on its thread. We use this to skip the initial-ticket
     * creation path (which is already AI-triaged at /support/ticket).
     *
     * Strategy: if the thread reports a single message and this entry's
     * id equals that message's id, this is the initial ticket. The
     * Thread::getMessages() method returns user messages in created
     * order; getNumMessages() returns the count.
     */
    private static function isFirstMessage($thread, $entry) {
        // Prefer getNumMessages() if available — fast, doesn't require
        // loading the full message list.
        if (method_exists($thread, 'getNumMessages')) {
            $count = (int) $thread->getNumMessages();
            // count==1 means this entry IS the first (and only) message.
            // count==0 shouldn't happen for a 'M' entry that just fired
            // the signal, but treat defensively as "not the first" so
            // we err on the side of firing the webhook.
            if ($count <= 1) {
                return true;
            }
            return false;
        }

        // Fallback: walk getMessages() and compare ids.
        if (method_exists($thread, 'getMessages')) {
            $messages = $thread->getMessages();
            if ($messages && count($messages) === 1) {
                return true;
            }
        }

        // If we can't tell, fire the webhook (don't lose follow-ups).
        return false;
    }

    private static function safeStringCall($obj, $method) {
        if (!is_object($obj) || !method_exists($obj, $method)) {
            return '';
        }
        $val = $obj->$method();
        if (is_object($val) && method_exists($val, 'asVar')) {
            return (string) $val->asVar();
        }
        return $val === null ? '' : (string) $val;
    }

    private static function safeIntCall($obj, $method) {
        if (!is_object($obj) || !method_exists($obj, $method)) {
            return 0;
        }
        $val = $obj->$method();
        return (int) $val;
    }

    private static function extractName($ticket) {
        if (!is_object($ticket) || !method_exists($ticket, 'getName')) {
            return '';
        }
        $name = $ticket->getName();
        if (!$name) {
            return '';
        }
        if (is_object($name)) {
            if (method_exists($name, 'asVar')) {
                return (string) $name->asVar();
            }
            // Fallback: try toString
            return (string) $name;
        }
        return (string) $name;
    }

    private static function extractBody($entry) {
        if (!method_exists($entry, 'getBody')) {
            return '';
        }
        $body = $entry->getBody();
        if (is_object($body)) {
            // ThreadEntryBody — has getClean() to strip HTML/quoted-text safely
            if (method_exists($body, 'getClean')) {
                return (string) $body->getClean();
            }
            // Fallback: stringify
            return (string) $body;
        }
        return (string) $body;
    }

    /**
     * postJSON fires the webhook. Short timeout, best-effort. Logs
     * non-2xx responses to osTicket's system log via $ost->logWarning.
     */
    private static function postJSON($url, $secret, $payload) {
        $json = json_encode($payload);
        if ($json === false) {
            self::logWarning('json_encode failed for webhook payload (ticket=' . ($payload['ticket_number'] ?? 'unknown') . ')');
            return;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            self::logWarning('curl_init failed for ' . $url);
            return;
        }

        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, self::WEBHOOK_TIMEOUT_SECONDS);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, self::WEBHOOK_TIMEOUT_SECONDS);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array(
            'Content-Type: application/json',
            'X-Scrollr-Webhook-Secret: ' . $secret,
            'X-Scrollr-Webhook-Source: osticket-scrollr-reply-api',
        ));

        $resp = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($code < 200 || $code >= 300 || $err) {
            self::logWarning(sprintf(
                'webhook to %s failed (ticket=%s): code=%d err=%s resp=%s',
                $url,
                $payload['ticket_number'] ?? '',
                $code,
                $err,
                is_string($resp) ? substr($resp, 0, 256) : ''
            ));
        }
    }

    private static function logWarning($msg) {
        global $ost;
        if ($ost && method_exists($ost, 'logWarning')) {
            $ost->logWarning('scrollr-reply-api', $msg);
        }
    }
}
