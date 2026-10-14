<?php
// Copy this file to /home/YOUR_CPANEL_USER/mtg-config.php  (your home folder,
// NOT inside public_html) and fill in the database details from
// cPanel -> MySQL Databases. Keeping it outside public_html means it can
// never be downloaded through the website.
return [
    'db_host' => 'localhost',
    'db_name' => 'PREFIX_mtgevent',   // full name incl. the cPanel prefix
    'db_user' => 'PREFIX_mtgapi',     // full name incl. the cPanel prefix
    'db_pass' => 'PUT-THE-PASSWORD-HERE',

    // set to false so only people with an invite code can create an account
    'allow_signup' => true,
];
