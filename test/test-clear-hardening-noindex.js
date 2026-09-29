/* test-clear-hardening-noindex.js — the date-range checks when the submittedAt index has
   not been created yet: the server must fall back to scanning and give the same answers. */
'use strict';
process.env.GOC_CLEAR_MODE = 'stub';
process.env.STUB_NO_SUBMITTED_INDEX = '1';
process.env.GOC_TEST_PORT = process.env.GOC_TEST_PORT || '8155';
require('./test-clear-hardening.js');
