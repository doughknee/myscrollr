<?php
/**
 * Scrollr Reply API plugin manifest.
 *
 * Adds a single endpoint to the osTicket HTTP API:
 *   POST /api/tickets/{number}/reply.json
 *
 * Allows trusted upstream services (the Scrollr core API) to post an
 * AGENT REPLY to an existing ticket, which:
 *   1. Creates a thread entry of type='R' (Response) attributed to a
 *      configured staff agent.
 *   2. Triggers the standard outbound user-notification email through
 *      osTicket's mailer (department reply-from + template set).
 *   3. Updates ost_ticket.lastupdate / isanswered / status as the agent
 *      web UI does on a normal reply.
 *   4. Fires the same signals (thread.response.posted) so any other
 *      plugins listening get the same hook.
 *
 * Auth: standard X-API-Key header. The same API key your existing
 * /api/tickets.json uses works here. The IP-bind on the API key is
 * enforced by osTicket's requireApiKey().
 *
 * Why this exists: osTicket has no documented REST endpoint to add a
 * reply to an existing ticket — only ticket creation is exposed.
 * Multiple workarounds (BCC threading, /api/tickets.email, collaborator
 * pattern, direct MySQL writes) were investigated and rejected; see
 * docs/superpowers/specs/2026-04-30-osticket-reply-plugin-design.md
 * for the research log if you need it.
 *
 * Tested against osTicket v1.17.x. The internal method this plugin
 * calls (Ticket::postReply) has been stable since at least 1.14 and is
 * the same method the agent web UI invokes when an agent submits a
 * reply form. As long as that signature stays put, this plugin will
 * keep working across upgrades.
 */

return array(
    'id'             => 'scrollr:reply-api',
    'version'        => '0.2.0',
    'name'           => 'Scrollr Reply API',
    'author'         => 'Scrollr',
    'description'    => /* @trans */ 'Adds a REST endpoint for posting agent replies to existing tickets via the standard X-API-Key auth.',
    'url'            => 'https://myscrollr.com',
    'requires'       => array(
        'osticket' => array(
            'min' => '1.17',
        ),
    ),
    'plugin'         => 'class.ScrollrReplyPlugin.php:ScrollrReplyPlugin',
);
