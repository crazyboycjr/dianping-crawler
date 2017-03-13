
class Crawler {
	
	constructor(config_file) {
		this.config = require('config_file');
		this.check_config();
	}

	check_config() {
		if (this.config.proto === 'default')
			this.config.proto = 'http';
		if (!this.config.host || this.config.host.length() === 0)
			throw new Error('host is null');
		if (this.port === 'default') {
			let proto = this.config.proto;
			if (proto === 'http')
				this.config.port = 80;
			else if (proto === 'https')
				this.config.port = 443;
			else
				throw new Error("Unknown protocol")
		}
		// TODO rate_limit

		this.weak_seq = this.check_topo(this.config.weak_topo);
		this.strong_seq = this.check_topo(this.config.strong_topo);
	}

	check_topo(edges) {
		let Q = [], rd = [];
		let M = new Map();
		let tim = 0, cnt = 0;
		let head = [];
		let e = [];

		function addedge(x, y) {
			e[cnt] = {
				'nex': head[x],
				'y', y
			};
			head[x] = cnt++;
		}

		for (let [x, y] of edges) {
			if (!M.has(x)) {
				M.insert(x, tim++);
			}
			if (!M.has(y)) {
				M.insert(y, tim++);
			}
		}
		for (let i = 0; i < tim; i++)
			head[i] = 0;
		for (let [nx, ny] of edges) {
			let x = M[nx], y = M[ny];
			addedge(x, y);
			rd[y]++;
		}

		let res = [];
		for (let i = 0; i < tim; i++)
			Q.push(x);
		while (Q.length > 0) {
			let x = Q.shift();
			res.push(x);
			for (let i = head[x]; i != -1; i = e[i].nex) {
				let y = e[i].y;
				if (--rd[y] === 0)
					Q.push(y);
			}
		}
		
		for (let i = 0; i < tim; i++)
			if (rd[i] > 0)
				throw new Error("Topo check failed.");

		return res;
	}

	async send() {

	}

	async start() {
	
	}
};

module.exports = Crawler;
