<?php
/**
 * ScrollrListController — read-only ticket listing + detail endpoints.
 *
 * Two routes registered by class.ScrollrReplyPlugin.php:
 *
 *   GET /api/tickets.json
 *   GET /api/tickets/{number}.json
 *
 * Both authenticated with the standard X-API-Key header. Same key the
 * existing reply endpoint uses; same IP-bind enforcement.
 *
 * Why the plugin handles this and not osTicket core: osTicket has no
 * documented HTTP API for reading tickets. The agent web UI is the
 * only first-class read path. These endpoints fill the gap by reading
 * directly from the well-known ost_ticket / ost_thread / ost_thread_entry
 * tables. Schema has been stable since 1.14.
 *
 * Filters supported on the list endpoint:
 *   ?status=open|closed|all       (default open)
 *   ?topic=bug,feature             (default bug,feature; comma-separated)
 *   ?topic=all                     (or "all" for no topic filter)
 *   ?limit=50                      (default 50, max 100)
 *   ?since=2026-04-01T00:00:00Z    (optional ISO-8601, filters by lastupdate)
 *   ?assigned_to=1                 (optional staff_id)
 *
 * Response: JSON object { count, tickets: [...] }. Tickets ordered
 * oldest-first (oldest unanswered ticket at top — most useful for a
 * to-do list).
 *
 * Detail endpoint returns the full thread with HTML stripped to plain
 * text. Useful for terminal tooling that needs to display the
 * conversation without a browser.
 */

require_once INCLUDE_DIR . 'class.api.php';
require_once INCLUDE_DIR . 'class.ticket.php';
require_once INCLUDE_DIR . 'class.thread.php';
require_once INCLUDE_DIR . 'class.user.php';

class ScrollrListController extends ApiController {

    // Inbound is GET — no body parsing needed. ApiController requires
    // implementing these even when unused.
    function getRequestStructure($format, $data = null) {
        return array();
    }

    function validate(&$data, $format, $strict = true) {
        return true;
    }

    /**
     * GET /api/tickets.json
     *
     * Lists tickets matching the query filters. Defaults to OPEN tickets
     * with topic IN ("bug", "feature"), oldest-first, limit 50.
     */
    function listTickets() {
        $key = $this->requireApiKey();
        if (!$key->canCreateTickets()) {
            return $this->exerr(403, __('API key not authorised'));
        }

        // ─── Parse + validate query params ─────────────────────────
        $status = isset($_GET['status']) ? strtolower(trim($_GET['status'])) : 'open';
        if (!in_array($status, ['open', 'closed', 'all'], true)) {
            return $this->exerr(400, __('status must be open|closed|all'));
        }

        $topicFilter = isset($_GET['topic']) ? trim($_GET['topic']) : 'bug,feature';
        $topics = ($topicFilter === '' || strtolower($topicFilter) === 'all')
            ? null
            : array_map('trim', array_filter(explode(',', $topicFilter)));

        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
        if ($limit < 1) $limit = 1;
        if ($limit > 100) $limit = 100;

        $since = null;
        if (!empty($_GET['since'])) {
            $ts = strtotime($_GET['since']);
            if ($ts === false) {
                return $this->exerr(400, __('since must be a parseable timestamp (ISO-8601)'));
            }
            $since = gmdate('Y-m-d H:i:s', $ts);
        }

        $assignedTo = isset($_GET['assigned_to']) ? (int) $_GET['assigned_to'] : null;

        // ─── Build SQL ──────────────────────────────────────────────
        // We query ost_ticket joined with the canonical lookup tables.
        // Status state filtering uses ost_ticket_status.state which
        // is the abstract grouping (open|closed|archived|deleted).
        $where = ['1=1'];
        $params = [];

        if ($status !== 'all') {
            $where[] = 'ts.state = :state';
            $params[':state'] = $status;
        }

        if ($topics !== null) {
            $placeholders = [];
            foreach ($topics as $i => $t) {
                $placeholders[] = ":topic{$i}";
                $params[":topic{$i}"] = $t;
            }
            // ost_help_topic.topic stores hierarchical topics as
            // "Parent / Child" — match either the leaf name or full path.
            $where[] = '(ht.topic IN (' . implode(',', $placeholders) . ')'
                   . ' OR SUBSTRING_INDEX(ht.topic, "/", -1) IN (' . implode(',', $placeholders) . '))';
        }

        if ($since !== null) {
            $where[] = 't.lastupdate >= :since';
            $params[':since'] = $since;
        }

        if ($assignedTo !== null && $assignedTo > 0) {
            $where[] = 't.staff_id = :staff';
            $params[':staff'] = $assignedTo;
        }

        $whereClause = implode(' AND ', $where);

        $sql = "
            SELECT
                t.ticket_id,
                t.number,
                t.created,
                t.lastupdate AS updated,
                t.staff_id,
                t.user_id,
                ht.topic AS topic_path,
                ts.name AS status_name,
                ts.state AS status_state,
                COALESCE(p.priority_urgency, 2) AS priority_urgency,
                COALESCE(p.priority, 'normal') AS priority_name,
                u.name AS user_name,
                ue.address AS user_email,
                CONCAT_WS(' ', s.firstname, s.lastname) AS staff_name,
                (SELECT COUNT(*) FROM " . TICKET_THREAD_ENTRY_TABLE . " te
                  INNER JOIN " . TICKET_THREAD_TABLE . " th2 ON te.thread_id = th2.id
                  WHERE th2.object_id = t.ticket_id
                    AND th2.object_type = 'T'
                    AND te.flags & 1 = 0) AS thread_count
            FROM " . TICKET_TABLE . " t
            LEFT JOIN " . TOPIC_TABLE . " ht ON t.topic_id = ht.topic_id
            LEFT JOIN " . TICKET_STATUS_TABLE . " ts ON t.status_id = ts.id
            LEFT JOIN " . TICKET_PRIORITY_TABLE . " p ON p.priority_id = ts.priority_id
            LEFT JOIN " . USER_TABLE . " u ON t.user_id = u.id
            LEFT JOIN " . USER_EMAIL_TABLE . " ue ON ue.user_id = u.id
              AND ue.address IS NOT NULL
            LEFT JOIN " . STAFF_TABLE . " s ON t.staff_id = s.staff_id
            WHERE {$whereClause}
            GROUP BY t.ticket_id
            ORDER BY t.created ASC
            LIMIT {$limit}
        ";

        // db_query supports neither prepared statements nor parameter
        // binding directly — osTicket uses positional ?-style or
        // direct interpolation in core. We use db_input() from core to
        // sanitise + quote each value, then substitute into the SQL.
        // db_input() handles strings, ints, and dates safely.
        $finalSql = $this->interpolateParams($sql, $params);
        $res = db_query($finalSql);
        if (!$res) {
            return $this->exerr(500, __('database query failed'));
        }

        $tickets = [];
        $baseUrl = function_exists('osTicket\Mailer\rebuild_baseurl') ? '' : '';
        global $cfg;
        $scpUrl = ($cfg && method_exists($cfg, 'getBaseUrl')) ? rtrim($cfg->getBaseUrl(), '/') : '';

        while ($row = db_fetch_array($res)) {
            $topic = $row['topic_path'] ? substr(strrchr('/' . $row['topic_path'], '/'), 1) : null;
            $tickets[] = array(
                'number'       => (string) $row['number'],
                'subject'      => $this->fetchSubject((int) $row['ticket_id']),
                'topic'        => $topic,
                'status'       => $row['status_name'],
                'status_state' => $row['status_state'],
                'priority'     => $row['priority_name'] ?: 'normal',
                'created'      => $this->isoFormat($row['created']),
                'updated'      => $this->isoFormat($row['updated']),
                'user_email'   => $row['user_email'],
                'user_name'    => $row['user_name'],
                'thread_count' => (int) $row['thread_count'],
                'assigned_to_id'   => $row['staff_id'] ? (int) $row['staff_id'] : null,
                'assigned_to_name' => trim($row['staff_name']) ?: null,
                'url'          => $scpUrl
                    ? $scpUrl . '/scp/tickets.php?id=' . (int) $row['ticket_id']
                    : null,
            );
        }

        $payload = array(
            'count'   => count($tickets),
            'tickets' => $tickets,
        );

        $this->response(200, json_encode($payload), 'application/json');
    }

    /**
     * GET /api/tickets/{number}.json
     *
     * Returns ticket metadata + full thread with HTML stripped.
     */
    function getTicket($args) {
        $key = $this->requireApiKey();
        if (!$key->canCreateTickets()) {
            return $this->exerr(403, __('API key not authorised'));
        }

        if (!isset($args['number']) || !preg_match('/^[\w-]+$/', $args['number'])) {
            return $this->exerr(400, __('Invalid ticket number in URL'));
        }

        $ticket = Ticket::lookupByNumber($args['number']);
        if (!$ticket) {
            return $this->exerr(404, __('Ticket not found'));
        }

        // Build the metadata header
        $user = $ticket->getUser();
        $staff = $ticket->getStaff();
        $topic = $ticket->getTopic();
        $status = $ticket->getStatus();
        $priority = $ticket->getPriority();

        global $cfg;
        $scpUrl = ($cfg && method_exists($cfg, 'getBaseUrl')) ? rtrim($cfg->getBaseUrl(), '/') : '';

        $thread = array();
        $threadObj = $ticket->getThread();
        if ($threadObj) {
            $entries = $threadObj->getEntries();
            // ImmutableSortedMap or QuerySet — iterate the same way.
            foreach ($entries as $entry) {
                if (!$entry || !method_exists($entry, 'getType')) continue;
                $type = $entry->getType();
                if (!in_array($type, ['M', 'R', 'N'], true)) continue;

                $bodyObj = $entry->getBody();
                $bodyText = '';
                if ($bodyObj && method_exists($bodyObj, 'getClean')) {
                    // ThreadEntryBody::getClean returns the textual form
                    // — strips HTML when format='html'.
                    $bodyText = $bodyObj->getClean();
                } elseif (method_exists($entry, 'body')) {
                    $bodyText = $this->stripHtml((string) $entry->body);
                }

                $thread[] = array(
                    'id'         => (int) $entry->getId(),
                    'type'       => $type,
                    'type_label' => $this->typeLabel($type),
                    'poster'     => $entry->getPoster() ?: '',
                    'created'    => $this->isoFormat($entry->getCreateDate()),
                    'body_plain' => $bodyText,
                );
            }
        }

        $payload = array(
            'number'    => (string) $ticket->getNumber(),
            'subject'   => (string) $ticket->getSubject(),
            'topic'     => $topic ? (string) $topic->getName() : null,
            'status'    => $status ? (string) $status->getName() : null,
            'status_state' => $status ? (string) $status->getState() : null,
            'priority'  => $priority ? (string) $priority->getName() : 'normal',
            'created'   => $this->isoFormat($ticket->getCreateDate()),
            'updated'   => $this->isoFormat($ticket->getLastUpdate()),
            'closed'    => $ticket->isClosed(),
            'user_name' => $user ? (string) $user->getName() : '',
            'user_email'=> $user ? (string) $user->getEmail() : '',
            'assigned_to_id'   => $staff ? (int) $staff->getId() : null,
            'assigned_to_name' => $staff ? (string) $staff->getName() : null,
            'url'       => $scpUrl
                ? $scpUrl . '/scp/tickets.php?id=' . (int) $ticket->getId()
                : null,
            'thread'    => $thread,
        );

        $this->response(200, json_encode($payload), 'application/json');
    }

    // ─── Helpers ────────────────────────────────────────────────────

    /**
     * Look up the ticket subject. Subjects historically lived on
     * ost_ticket.subject but recent osTicket stores them on the form
     * answer for the ticket's primary form. getSubject() handles both.
     */
    private function fetchSubject($ticketId) {
        $ticket = Ticket::lookup($ticketId);
        return $ticket ? (string) $ticket->getSubject() : '';
    }

    private function typeLabel($type) {
        switch ($type) {
            case 'M': return 'User message';
            case 'R': return 'Agent response';
            case 'N': return 'Internal note';
            default:  return 'Entry';
        }
    }

    private function isoFormat($mysqlDateOrTimestamp) {
        if (empty($mysqlDateOrTimestamp)) return null;
        $ts = is_numeric($mysqlDateOrTimestamp)
            ? (int) $mysqlDateOrTimestamp
            : strtotime($mysqlDateOrTimestamp . ' UTC');
        if ($ts === false || $ts === 0) return null;
        return gmdate('Y-m-d\TH:i:s\Z', $ts);
    }

    private function stripHtml($html) {
        if ($html === null || $html === '') return '';
        // Decode HTML entities, then strip tags. Replace block-level
        // closing tags with newlines so paragraphs survive.
        $html = preg_replace('#</p>|<br\s*/?>|</div>|</li>#i', "\n", $html);
        $text = strip_tags($html);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // Collapse 3+ newlines to 2
        $text = preg_replace("/\n{3,}/", "\n\n", $text);
        return trim($text);
    }

    /**
     * Substitute :name placeholders in $sql with safely-quoted values.
     * Uses db_input() which handles SQL escaping (osTicket's helper).
     */
    private function interpolateParams($sql, $params) {
        if (empty($params)) return $sql;
        // Sort placeholders by length descending so :status doesn't
        // collide with :status_state, etc.
        uksort($params, function ($a, $b) { return strlen($b) - strlen($a); });
        foreach ($params as $key => $value) {
            $quoted = db_input($value);
            $sql = str_replace($key, $quoted, $sql);
        }
        return $sql;
    }
}
