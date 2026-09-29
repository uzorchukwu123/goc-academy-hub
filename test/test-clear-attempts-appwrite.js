/* test-clear-attempts-appwrite.js — the clear/resit/restore checks again, with
   the server in Appwrite mode on the in-memory stand-in (never a live project). */
'use strict';
process.env.GOC_CLEAR_MODE = 'stub';
process.env.GOC_TEST_PORT = process.env.GOC_TEST_PORT || '8152';
require('./test-clear-attempts.js');
