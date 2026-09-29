/* test-clear-hardening-appwrite.js — the hardening checks with the server in Appwrite
   mode on the in-memory stand-in, including the fault-injection ones. */
'use strict';
process.env.GOC_CLEAR_MODE = 'stub';
process.env.GOC_TEST_PORT = process.env.GOC_TEST_PORT || '8154';
require('./test-clear-hardening.js');
