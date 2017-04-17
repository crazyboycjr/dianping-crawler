'use strict';

const fs = require('fs');
const util = require('util');

var prog_log;

function LOG() {
	let args = Array.prototype.slice.call(arguments);
	let output = '[' + (new Date).toUTCString() + ']: '
		+ args.map(x => typeof x === 'string' ? x : util.inspect(x)).join(' ');
	console.log(output);
	prog_log.write(output + '\n');
}

function init(f) {
	prog_log = fs.createWriteStream(f, { flags: 'a' });
}

module.exports = init;
module.exports.LOG = LOG;
