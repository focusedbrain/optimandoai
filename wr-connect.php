<?php
/**
 * WR Connect -- publisher onboarding for the Optirando(TM)/WR system (Public Handshake).
 * Version 0.1.5 * platform-neutral: runs on any PHP hosting (PHP 7.2+), independent
 * of the CMS. No programming knowledge required.
 *
 * Usage:
 *   1. Upload this file to the ROOT DIRECTORY of your website (where index.html /
 *      index.php lives).
 *   2. Open it in your browser:  https://your-domain.com/wr-connect.php
 *   3. Create the displayed DNS record at your domain provider -> "Check now".
 *
 * What this file does:
 *   - generates the Ed25519 keys DIRECTLY ON THIS SERVER on first run
 *     (they are never transmitted anywhere -- R-SIG-6),
 *   - writes the signed manifest as a STATIC file to /.well-known/wr/manifest
 *     (origin channel of the dual-channel verification, Annex IX section IX.3.5 --
 *     no rewrite rules or server configuration needed),
 *   - shows the TXT record for _wr.<domain> ready to copy (DNS channel),
 *   - offers self-checks for both channels.
 *
 * Later updates of this file add the login/logout binding (Binding Challenge,
 * LBCP, heartbeat -- Annex XI Login-Bound section 2-section 5); the session-binding key needed
 * for that is generated now and declared in the manifest.
 */

declare(strict_types=1);
error_reporting(E_ALL & ~E_DEPRECATED);

const WRC_RECORD_VERSION   = 'WR1';
const WRC_PROTOCOL_VERSION = '2.0';
const WRC_DATA_DIR         = __DIR__ . '/wr-connect-data';
const WRC_STATE_FILE       = WRC_DATA_DIR . '/state.php';
const WRC_WELLKNOWN_DIR    = __DIR__ . '/.well-known/wr';
const WRC_WELLKNOWN_FILE   = WRC_WELLKNOWN_DIR . '/manifest';

// ===========================================================================
// Crypto core -- byte-identical to the TypeScript reference (@wr/crypto)
// ===========================================================================

function wrc_b64u(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function wrc_from_b64u(string $s): string {
    return base64_decode(strtr($s, '-_', '+/'));
}

/** Canonical JSON serialization (R-SIG-3): recursively sorted keys, no whitespace. */
function wrc_canonical_json($value): string {
    if ($value === null)  return 'null';
    if (is_bool($value))  return $value ? 'true' : 'false';
    if (is_int($value))   return (string) $value;
    if (is_float($value)) throw new InvalidArgumentException('floats not allowed');
    if (is_string($value)) return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (is_array($value)) {
        $isList = ($value === [] || array_keys($value) === range(0, count($value) - 1));
        if ($isList) return '[' . implode(',', array_map('wrc_canonical_json', $value)) . ']';
        ksort($value, SORT_STRING);
        $parts = [];
        foreach ($value as $k => $v) {
            $parts[] = json_encode((string) $k, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ':' . wrc_canonical_json($v);
        }
        return '{' . implode(',', $parts) . '}';
    }
    throw new InvalidArgumentException('unsupported type ' . gettype($value));
}

function wrc_sha256_tag(string $data): string {
    return 'sha256:' . wrc_b64u(hash('sha256', $data, true));
}

function wrc_generate_keypair(string $kidPrefix): array {
    $kp     = sodium_crypto_sign_keypair();
    $public = sodium_crypto_sign_publickey($kp);
    $fpB64u = wrc_b64u(hash('sha256', $public, true));
    return [
        'kid'         => $kidPrefix . '-' . substr($fpB64u, 0, 8),
        'secret_b64u' => wrc_b64u(sodium_crypto_sign_secretkey($kp)),
        'public_b64u' => wrc_b64u($public),
        'fingerprint' => 'sha256:' . $fpB64u,
    ];
}

function wrc_build_manifest(string $pid, string $host, string $env, array $rootKey, array $sbk): array {
    $origin       = 'https://' . $host;
    $minimal      = ['automations' => [], 'origins' => [$origin], 'pid' => $pid, 'version' => 1];
    $manifestRoot = wrc_sha256_tag(wrc_canonical_json($minimal));
    $doc = [
        'v'                 => WRC_RECORD_VERSION,
        'pid'               => $pid,
        'proto'             => WRC_PROTOCOL_VERSION,
        'origins'           => [$origin],
        'rootKey'           => ['kid' => $rootKey['kid'], 'alg' => 'Ed25519', 'pub' => $rootKey['public_b64u']],
        'sessionBindingKey' => ['kid' => $sbk['kid'],     'alg' => 'Ed25519', 'pub' => $sbk['public_b64u']],
        'manifestRoot'      => $manifestRoot,
        'iat'               => time(),
        'env'               => $env,
    ];
    $doc['sig'] = wrc_b64u(sodium_crypto_sign_detached(wrc_canonical_json($doc), wrc_from_b64u($rootKey['secret_b64u'])));
    return $doc;
}

function wrc_dns_value(string $pid, string $rootFingerprint, string $manifestRoot): string {
    return sprintf('v=%s; pid=%s; rk=%s; mr=%s; proto=%s',
        WRC_RECORD_VERSION, $pid, $rootFingerprint, $manifestRoot, WRC_PROTOCOL_VERSION);
}

// ===========================================================================
// State (keys stay on this server; the state file is not readable via browser)
// ===========================================================================

function wrc_state(): ?array {
    if (!is_file(WRC_STATE_FILE)) return null;
    $raw = file_get_contents(WRC_STATE_FILE);
    if ($raw === false) return null;
    // Format: PHP guard line + JSON from line 2 -- direct browser access only executes the guard.
    $json = substr($raw, (int) strpos($raw, "\n") + 1);
    $s = json_decode($json, true);
    return is_array($s) ? $s : null;
}

function wrc_save_state(array $s): void {
    if (!is_dir(WRC_DATA_DIR)) {
        mkdir(WRC_DATA_DIR, 0700, true);
        @chmod(WRC_DATA_DIR, 0700); // explicit: mkdir mode can be altered by the host's umask
        // Defense in depth for Apache hosts; the PHP guard protects even without .htaccess.
        @file_put_contents(WRC_DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
        @file_put_contents(WRC_DATA_DIR . '/index.html', '');
    }
    $payload = "<?php http_response_code(404); exit; ?>\n" . json_encode($s, JSON_UNESCAPED_SLASHES);
    file_put_contents(WRC_STATE_FILE, $payload, LOCK_EX);
    @chmod(WRC_STATE_FILE, 0600);
}

function wrc_write_wellknown(array $manifest): bool {
    if (!is_dir(WRC_WELLKNOWN_DIR) && !@mkdir(WRC_WELLKNOWN_DIR, 0755, true)) return false;
    // Static file -- works on every server without configuration (no rewrites needed).
    $ok = @file_put_contents(WRC_WELLKNOWN_FILE, wrc_canonical_json($manifest), LOCK_EX);
    // Content-type hint for Apache (optional; verification checks the content, not the header):
    @file_put_contents(WRC_WELLKNOWN_DIR . '/.htaccess', "<Files \"manifest\">\nForceType application/json\n</Files>\n");
    return $ok !== false;
}

function wrc_host(): string {
    $h = strtolower(preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? ''));
    return preg_match('/^[a-z0-9.-]+$/', $h) ? $h : '';
}

// ===========================================================================
// First-run setup + actions
// ===========================================================================

function wrc_setup(string $host): array {
    $s = [
        'pid'       => $host,
        'env'       => 'test',
        'host'      => $host,
        'admin_key' => wrc_b64u(random_bytes(18)),
        'root'      => wrc_generate_keypair('root'),
        'sbk'       => wrc_generate_keypair('sbk'),
        'created'   => date('c'),
    ];
    $s['manifest'] = wrc_build_manifest($s['pid'], $host, $s['env'], $s['root'], $s['sbk']);
    wrc_save_state($s);
    // Also store the access key where it is reachable via FTP (in case it is lost):
    wrc_write_admin_key_backup($s['admin_key']);
    wrc_write_wellknown($s['manifest']);
    return $s;
}

// ---------------------------------------------------------------------------
// Admin authentication: session cookie instead of key-in-URL (v0.1.2).
// The access key is entered once (login form or FTP-recovery link) and is then
// exchanged for a short-lived HttpOnly session cookie -- it never persists in
// the address bar, browser history, or server access logs.
// ---------------------------------------------------------------------------

/**
 * FTP-readable backup of the access key, guarded against browser download.
 * Same guard pattern as state.php: a direct request executes the guard and
 * returns an empty 404 -- this works on every host that runs PHP, with or
 * without .htaccess support (a plain .txt would be downloadable on
 * nginx-class hosts that ignore .htaccess).
 */
function wrc_write_admin_key_backup(string $key): void {
    $f = WRC_DATA_DIR . '/admin-key.php';
    @file_put_contents($f, "<?php http_response_code(404); exit; ?>\nWR Connect access key (the line below):\n" . $key . "\n", LOCK_EX);
    @chmod($f, 0600);
}

function wrc_key_valid(array $s, string $k): bool {
    return $k !== '' && hash_equals($s['admin_key'], $k);
}

/** Creates a 24h admin session (cookie + server-side token) and returns its CSRF token. */
function wrc_new_session(array &$s): string {
    $now  = time();
    $keep = [];
    foreach ($s['sessions'] ?? [] as $sess) {
        if (($sess['exp'] ?? 0) > $now) { $keep[] = $sess; }
    }
    $tok  = wrc_b64u(random_bytes(18));
    $csrf = wrc_b64u(random_bytes(18));
    $keep[] = ['tok' => $tok, 'csrf' => $csrf, 'exp' => $now + 86400];
    $s['sessions'] = array_slice($keep, -5); // at most a handful of parallel sessions
    wrc_save_state($s);
    setcookie('wrc_session', $tok, [
        'expires'  => $now + 86400,
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,          // not readable by any JavaScript
        'samesite' => 'Strict',      // never sent on cross-site requests (CSRF baseline)
    ]);
    return $csrf;
}

/** Returns the active session for the request cookie, or null. */
function wrc_session(array $s): ?array {
    $tok = (string) ($_COOKIE['wrc_session'] ?? '');
    if ($tok === '') { return null; }
    foreach ($s['sessions'] ?? [] as $sess) {
        if (($sess['exp'] ?? 0) > time() && hash_equals((string) $sess['tok'], $tok)) { return $sess; }
    }
    return null;
}

// Self-checks -----------------------------------------------------------------

function wrc_check_dns(string $host, string $expected): array {
    if (!function_exists('dns_get_record')) return ['warn', 'DNS check not possible on this hosting -- please check externally (e.g. dnschecker.org, type TXT, name _wr.' . $host . ').'];
    $rows = @dns_get_record('_wr.' . $host, DNS_TXT);
    if ($rows === false) return ['warn', 'DNS lookup failed -- please try again later.'];
    $values = [];
    foreach ($rows as $r) $values[] = isset($r['entries']) ? implode('', (array) $r['entries']) : (string) ($r['txt'] ?? '');
    $wr = array_values(array_filter($values, function ($v) { return strpos(ltrim($v), 'v=') === 0; }));
    if (count($wr) === 0) return ['red', 'No WR record found yet. DNS changes can take minutes to hours depending on your provider.'];
    if (count($wr) > 1)  return ['red', 'Multiple WR records found -- there must be exactly one. Please delete the old ones.'];
    return $wr[0] === $expected
        ? ['green', 'DNS record set correctly.']
        : ['red', 'A WR record exists, but the value differs. Please copy the value below again, exactly.'];
}

function wrc_http_get(string $url): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ($body !== false && $code === 200) ? (string) $body : null;
    }
    $ctx = stream_context_create(['http' => ['timeout' => 8, 'follow_location' => 0]]);
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

function wrc_check_wellknown(string $host, string $pid): array {
    if (!is_file(WRC_WELLKNOWN_FILE)) return ['red', 'The manifest file could not be written. Is wr-connect.php really in the website root, and is PHP allowed to create files there?'];
    $body = wrc_http_get('https://' . $host . '/.well-known/wr/manifest');
    if ($body === null) return ['warn', 'Self-request not possible (some hosts block it). Please open the address in your browser -- if you see text starting with {"env", everything is fine.'];
    $doc = json_decode($body, true);
    return (is_array($doc) && ($doc['pid'] ?? null) === $pid)
        ? ['green', 'Manifest is reachable at /.well-known/wr/manifest.']
        : ['red', 'Something other than the current manifest answers at /.well-known/wr/manifest (possibly a redirect or an error page).'];
}

// ===========================================================================
// Page
// ===========================================================================

function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function wrc_page(string $title, string $body): void {
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex');
    header('Referrer-Policy: no-referrer');   // the admin key travels in the URL - never expose it via Referer
    header('Cache-Control: no-store');        // never cache admin pages (they embed the admin key)
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>' . e($title) . '</title><style>'
       . 'body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 16px;color:#1c2430}'
       . 'h1{font-size:26px}h2{font-size:19px;margin-top:32px}code{background:#f2f4f7;padding:2px 6px;border-radius:4px;word-break:break-all}'
       . 'table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e3e7ee;vertical-align:top}th{width:150px;color:#555}'
       . '.btn{display:inline-block;background:#1d4ed8;color:#fff;border:0;border-radius:6px;padding:9px 16px;text-decoration:none;cursor:pointer;font-size:15px}'
       . '.btn.sec{background:#e8ecf3;color:#1c2430}.ok{color:#1a7f37}.bad{color:#b91c1c}.warn{color:#b45309}'
       . '.note{background:#f6f8fb;border:1px solid #e3e7ee;border-radius:8px;padding:12px 14px;margin:14px 0}'
       . '</style></head><body>' . $body . '<p style="margin-top:48px;color:#8a93a3;font-size:12px">WR Connect 0.1.5 &middot; Optirando&trade; Public Handshake &middot; keys never leave this server</p></body></html>';
    exit;
}

function wrc_badge(array $r): string {
    [$state, $msg] = $r;
    $cls = ['green' => 'ok', 'red' => 'bad', 'warn' => 'warn'][$state] ?? 'warn';
    return '<p class="' . $cls . '">&#9679; ' . e($msg) . '</p>';
}

// --- Routing ----------------------------------------------------------------

if (!function_exists('sodium_crypto_sign_keypair')) {
    wrc_page('WR Connect', '<h1>WR Connect</h1><p class="bad">This hosting does not provide the required cryptography (Sodium, standard since PHP 7.2). Please ask your host to enable PHP >= 7.3.</p>');
}

$host = wrc_host();
if ($host === '') { wrc_page('WR Connect', '<h1>WR Connect</h1><p class="bad">Could not determine the hostname.</p>'); }
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$self  = strtok($_SERVER['REQUEST_URI'] ?? ('/' . basename(__FILE__)), '?');

$s = wrc_state();

// First-run setup: runs automatically on the first visit.
if ($s === null) {
    if (!$https) {
        wrc_page('WR Connect', '<h1>WR Connect</h1><p class="bad">Please open this page via <strong>https://</strong>: <a href="https://' . e($host) . '/' . e(basename(__FILE__)) . '">https://' . e($host) . '/' . e(basename(__FILE__)) . '</a></p><p>Secure setup is not possible without HTTPS. Virtually every host offers free HTTPS certificates (Let\'s Encrypt).</p>');
    }
    $s = wrc_setup($host);
    wrc_new_session($s); // auto-login for the person completing setup
    wrc_page('WR Connect &mdash; set up', '<h1>&check; Setup complete</h1>'
        . '<p>Your keys have been generated and the manifest has been published.</p>'
        . '<div class="note"><strong>Your access key &mdash; store it like a password:</strong><br>'
        . '<code id="ak">' . e($s['admin_key']) . '</code> '
        . '<button class="btn sec" onclick="navigator.clipboard.writeText(document.getElementById(\'ak\').innerText);this.innerText=\'Copied\'">Copy</button><br>'
        . '<small>You will need it to sign in to this page in the future. It is also stored in '
        . '<code>wr-connect-data/admin-key.php</code> on your web space (open it via FTP; the key is on the last line). '
        . 'It is never part of any web address.</small></div>'
        . '<p><a class="btn" href="' . e($self) . '">Continue to DNS setup &rarr;</a></p>');
}

// Migration (v0.1.3): remove any plain-text key backup from older versions.
if (is_file(WRC_DATA_DIR . '/admin-key.txt')) {
    @unlink(WRC_DATA_DIR . '/admin-key.txt');
}
// Self-healing (v0.1.4): recreate the guarded key backup whenever it is missing
// (manual cleanup of wr-connect-data, or a silently failed first write).
if (!is_file(WRC_DATA_DIR . '/admin-key.php')) {
    wrc_write_admin_key_backup($s['admin_key']);
}

// Sign-in with the access key (POST form; SameSite=Strict cookie afterwards).
if (($_POST['action'] ?? '') === 'login') {
    if (wrc_key_valid($s, (string) ($_POST['access_key'] ?? ''))) {
        wrc_new_session($s);
        header('Location: ' . $self);
        exit;
    }
    wrc_page('WR Connect &mdash; sign in', '<h1>WR Connect</h1><p class="bad">Wrong access key.</p>' . wrc_login_form($self));
}

// Legacy/FTP-recovery path: a ?key= link is accepted once, exchanged for a
// session cookie, and immediately redirected to a clean URL so the key does
// not linger in the address bar or history.
if (isset($_GET['key'])) {
    if (wrc_key_valid($s, (string) $_GET['key'])) {
        wrc_new_session($s);
    }
    header('Location: ' . $self);
    exit;
}

$sess = wrc_session($s);
if ($sess === null) {
    wrc_page('WR Connect &mdash; sign in', '<h1>WR Connect</h1>'
        . '<p>This website is already set up. Please sign in with your access key '
        . '(shown once at setup; also stored in <code>wr-connect-data/admin-key.php</code> -- open it via FTP / file manager, the key is on the last line).</p>'
        . wrc_login_form($self));
}

// Actions (valid session + CSRF token required):
if (($_POST['action'] ?? '') === 'save') {
    if (!hash_equals((string) $sess['csrf'], (string) ($_POST['csrf'] ?? ''))) {
        wrc_page('WR Connect', '<h1>WR Connect</h1><p class="bad">Invalid request (CSRF check failed). Please go back and try again.</p>');
    }
    $pid = trim((string) ($_POST['pid'] ?? $s['pid']));
    if (preg_match('/^[A-Za-z0-9._-]{1,64}$/', $pid)) $s['pid'] = $pid;
    $s['env'] = (($_POST['env'] ?? 'test') === 'prod') ? 'prod' : 'test';
    $s['host'] = $host;
    $s['manifest'] = wrc_build_manifest($s['pid'], $host, $s['env'], $s['root'], $s['sbk']);
    wrc_save_state($s);
    wrc_write_wellknown($s['manifest']);
    header('Location: ' . $self . '?saved=1');
    exit;
}

$dns = wrc_dns_value($s['pid'], $s['root']['fingerprint'], $s['manifest']['manifestRoot']);
$doCheck = isset($_GET['check']);

$checksHtml = '';
if ($doCheck) {
    $checksHtml = wrc_badge(wrc_check_wellknown($host, $s['pid'])) . wrc_badge(wrc_check_dns($host, $dns));
}

wrc_page('WR Connect &mdash; ' . $host,
    '<h1>WR Connect</h1>'
  . (isset($_GET['saved']) ? '<p class="ok">Saved &mdash; copy the DNS value below again if the publisher ID changed.</p>' : '')
  . (is_file(WRC_DATA_DIR . '/admin-key.php') ? '' : '<p class="warn">&#9679; The key backup file <code>wr-connect-data/admin-key.php</code> could not be written on this hosting. Your access key is also stored inside <code>wr-connect-data/state.php</code> (field "admin_key", readable via FTP).</p>')
  . '<p>Only <strong>one step</strong> left: create the following DNS record at your domain provider (wherever you manage your domain &mdash; e.g. Cloudflare, GoDaddy, IONOS, Namecheap).</p>'
  . '<h2>Step 1 &mdash; Create the DNS record</h2>'
  . '<table>'
  . '<tr><th>Type</th><td>TXT</td></tr>'
  . '<tr><th>Name / Host</th><td><code>_wr</code> <small>(some providers require the full form: <code>_wr.' . e($host) . '</code>)</small></td></tr>'
  . '<tr><th>Value</th><td><code id="v">' . e($dns) . '</code><br><button class="btn sec" style="margin-top:8px" onclick="navigator.clipboard.writeText(document.getElementById(\'v\').innerText);this.innerText=\'Copied\'">Copy</button></td></tr>'
  . '</table>'
  . '<h2>Step 2 &mdash; Check</h2>'
  . '<p>Manifest address (already live): <a href="https://' . e($host) . '/.well-known/wr/manifest" target="_blank" rel="noopener noreferrer">https://' . e($host) . '/.well-known/wr/manifest</a></p>'
  . '<p><a class="btn" href="' . e($self) . '?check=1">Check now</a></p>' . $checksHtml
  . '<h2>Settings</h2>'
  . '<form method="post" action="' . e($self) . '"><input type="hidden" name="csrf" value="' . e((string) $sess['csrf']) . '"><input type="hidden" name="action" value="save">'
  . '<table>'
  . '<tr><th>Publisher ID</th><td><input name="pid" value="' . e($s['pid']) . '" pattern="[A-Za-z0-9._-]{1,64}" style="width:320px;padding:6px"> <small>Default: your domain.</small></td></tr>'
  . '<tr><th>Environment</th><td><select name="env"><option value="test"' . ($s['env'] === 'test' ? ' selected' : '') . '>Test</option><option value="prod"' . ($s['env'] === 'prod' ? ' selected' : '') . '>Production</option></select></td></tr>'
  . '</table><p><button class="btn" type="submit">Save</button></p></form>'
  . '<div class="note"><small>Key IDs: ' . e($s['root']['kid']) . ' &middot; ' . e($s['sbk']['kid']) . '. The private keys live exclusively in <code>wr-connect-data/</code> on this server and cannot be retrieved via browser. A later update adds the login/logout binding &mdash; nothing further to prepare.</small></div>'
);

function wrc_login_form(string $self): string {
    return '<form method="post" action="' . e($self) . '" style="margin-top:16px">'
         . '<input type="hidden" name="action" value="login">'
         . '<p><input type="password" name="access_key" placeholder="Access key" autocomplete="current-password" style="width:320px;padding:8px"></p>'
         . '<p><button class="btn" type="submit">Sign in</button></p></form>';
}