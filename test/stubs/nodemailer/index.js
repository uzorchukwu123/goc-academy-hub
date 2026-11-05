'use strict';
/* Test-only SMTP adapter. It captures the actual mail handed to Nodemailer
   outside the repository so route tests can prove the emailed code is the one
   the server validates without publishing it in an API response or log. */
var fs = require('fs');
module.exports = {
  createTransport: function (options) {
    if (!options || !options.host) throw new Error('test SMTP host missing');
    return {
      sendMail: async function (message) {
        var file = process.env.GOC_TEST_MAIL_FILE;
        if (!file) throw new Error('test mail capture path missing');
        fs.appendFileSync(file, JSON.stringify({ options: options, message: message }) + '\n', { mode: 0o600 });
        return { accepted: [message.to] };
      }
    };
  }
};
