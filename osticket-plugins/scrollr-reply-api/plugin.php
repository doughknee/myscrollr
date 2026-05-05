<?php
/**
 * Scrollr Reply API plugin manifest.
 *
 * Adds these endpoints to the osTicket HTTP API:
 *   POST /api/tickets/{number}/reply.json   — post an agent reply (v0.1.0)
 *   GET  /api/tickets.json                  — list tickets (v0.3.0)
 *   GET  /api/tickets/{number}.json         — ticket detail with thread (v0.3.0)
 *
 * The reply endpoint allows trusted upstream services (the Scrollr core
 * API) to post an AGENT REPLY to an existing ticket. See
 * api.reply.php for details.
 *
 * The list + detail endpoints (v0.3.0) provide read-only access to
 * tickets for tooling like the local `bugs`/`bug` CLI scripts in
 * scripts/bug-tools/. They expose subsets of ost_ticket / ost_thread /
 * ost_thread_entry without going through osTicket's web UI. Useful
 * for keeping a developer to-do list in osTicket without copy-paste.
 *
 * Auth: standard X-API-Key header for ALL endpoints. The same API key
 * your existing /api/tickets.json uses works here. The IP-bind on the
 * API key is enforced by osTicket's requireApiKey().
 *
 * Why this exists: osTicket has no documented REST endpoints for
 * either posting replies OR listing/reading existing tickets — only
 * ticket creation is exposed in core. This plugin fills both gaps with
 * a small set of read + write endpoints, all behind the same auth.
 *
 * Tested against osTicket v1.17.x. The internal method the reply
 * endpoint calls (Ticket::postReply) has been stable since at least
 * 1.14 and is the same method the agent web UI invokes. The list +
 * detail endpoints query ost_ticket, ost_thread, ost_thread_entry,
 * ost_help_topic, ost_user, ost_user_email, ost_staff, and
 * ost_ticket_status directly — table names + key columns have been
 * stable since at least 1.14.
 */

return array(
    'id'             => 'scrollr:reply-api',
    'version'        => '0.3.0',
    'name'           => 'Scrollr Reply API',
    'author'         => 'Scrollr',
    'description'    => /* @trans */ 'Adds REST endpoints for posting agent replies + listing/reading tickets via the standard X-API-Key auth.',
    'url'            => 'https://myscrollr.com',
    'requires'       => array(
        'osticket' => array(
            'min' => '1.17',
        ),
    ),
    'plugin'         => 'class.ScrollrReplyPlugin.php:ScrollrReplyPlugin',
);
