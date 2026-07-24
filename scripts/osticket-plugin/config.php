<?php
/**
 * Stub PluginConfig for Scrollr Reply API.
 *
 * The plugin has no admin-configurable options — auth and the staff
 * agent both come from the request payload, not from per-instance
 * config. Despite that, osTicket REQUIRES every plugin to declare a
 * config class for `Plugin::bootstrap()` to actually fire.
 *
 * Specifically: `PluginInstance::bootstrap()` (in class.plugin.php
 * around line 1159 on osTicket 1.18) reads:
 *
 *     if ($this->isEnabled()
 *             && ($plugin = $this->getPlugin())
 *             && ($plugin->getConfig($this)))    // <-- short-circuits here
 *         return $plugin->bootstrap();
 *
 * `Plugin::getConfig()` in turn returns null when the plugin's
 * `$config_class` is null. So without a config class declared, the
 * outer `bootstrap()` chain short-circuits and the plugin's own
 * `bootstrap()` never runs — meaning Signal::connect('api', ...) is
 * never registered, meaning the new URL pattern never gets appended,
 * meaning the route returns "URL not supported".
 *
 * Returning an empty `getOptions()` produces a configure dialog with
 * no fields, which is fine — the admin just clicks "Save" once.
 */

require_once INCLUDE_DIR . 'class.plugin.php';

class ScrollrReplyPluginConfig extends PluginConfig {
    function getOptions() {
        return array();
    }
}
