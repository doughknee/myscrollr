<?php
/**
 * Scrollr Reply API — plugin entry point.
 *
 * Hooks the 'api' Signal that osTicket emits in api/http.php right after
 * its built-in URL dispatcher is registered. We append a single
 * URL pattern that maps to ScrollrReplyController::reply().
 *
 * The plugin has no admin-configurable options for now — auth is the
 * same X-API-Key the rest of the API already uses. We still must
 * declare a config class because osTicket's PluginInstance::bootstrap()
 * short-circuits when getConfig() returns null (the && chain at line
 * ~1159 of class.plugin.php). See config.php for the stub class.
 */

require_once INCLUDE_DIR . 'class.plugin.php';
require_once dirname(__FILE__) . '/config.php';

class ScrollrReplyPlugin extends Plugin {

    var $config_class = "ScrollrReplyPluginConfig";
    var $config;

    function bootstrap() {
        // Load the controller + notifier classes up-front so they're
        // available when their respective signals fire. We can't rely
        // on url_post()'s file-loader syntax to resolve plugin paths
        // cleanly across versions — safer to require_once explicitly
        // here.
        require_once dirname(__FILE__) . '/api.reply.php';
        require_once dirname(__FILE__) . '/api.list.php';
        require_once dirname(__FILE__) . '/notify.message.php';

        // The 'api' signal in api/http.php fires once with the global
        // dispatcher. Plugins append their own routes here.
        Signal::connect('api', function ($dispatcher) {
            // POST /api/tickets/{number}/reply.json — post agent reply
            $dispatcher->append(
                url_post(
                    "^/tickets/(?P<number>[\w-]+)/reply\.json$",
                    array('ScrollrReplyController', 'reply')
                )
            );

            // GET /api/tickets.json — list tickets (filter by status,
            // topic, etc.). Used by the local `bugs` CLI tool and any
            // future tooling that needs read-only access to tickets.
            $dispatcher->append(
                url_get(
                    "^/tickets\.json$",
                    array('ScrollrListController', 'listTickets')
                )
            );

            // GET /api/tickets/{number}.json — ticket detail with full
            // thread (messages, responses, notes — HTML stripped).
            // Used by the local `bug <number>` CLI tool.
            $dispatcher->append(
                url_get(
                    "^/tickets/(?P<number>[\w-]+)\.json$",
                    array('ScrollrListController', 'getTicket')
                )
            );
        });

        // 'threadentry.created' fires for EVERY new thread entry —
        // user messages (type='M'), agent replies ('R'), notes ('N').
        // The notifier filters to user messages on tickets and posts
        // a webhook to the Scrollr core API so it can run AI triage
        // on user follow-ups (the existing /support/ticket flow only
        // triages the initial ticket creation; replies need this hook
        // to keep the conversation going).
        Signal::connect('threadentry.created', function ($entry, $data = null) {
            ScrollrReplyNotify::notifyUserMessage($entry);
        });
    }
}
