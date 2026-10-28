/*
	Background: prior and posterior samples.

	Faint "stars" are samples from a broad prior over the page. They wander
	by Langevin dynamics (a gradient step on the log density plus Gaussian
	noise), which keeps them distributed according to the prior.

	Clicking the logo starts the eclipse, which plays the part of the
	evidence: the samples move to a sharply peaked posterior around the
	sun's rim (dense at the edge, thinning outwards, reaching further along
	the corona's streamers), so the corona is made of posterior samples.
	As the eclipse fades they return to the prior.
*/
(function() {

	var canvas = document.getElementById('bg-canvas'),
		logo = document.querySelector('#header .logo');
	if (!canvas || !canvas.getContext || !logo) return;

	var ctx = canvas.getContext('2d'),
		reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	var N = 450,
		EPS = 0.06,				// Langevin step size (px^2 per frame): sqrt(EPS) ~ 0.25 px of noise per frame
		// Eclipse timeline (ms after the click), matched to the CSS animation.
		IN_START = 150, IN_END = 1100,		// prior -> posterior
		OUT_START = 2600, OUT_END = 4400,	// posterior -> prior
		// Corona streamers, as in the CSS: centre (deg, clockwise from up), half-width (deg), strength.
		LOBES = [[78, 20, 0.30], [258, 24, 0.26], [22, 9, 0.14], [148, 12, 0.12], [205, 8, 0.10], [322, 11, 0.15]],
		ALPHA_LEVELS = 16;

	var W, H, dpr, dim,
		cx = 0, cy = 0, R = 40,
		particles = [],
		eclipse = null,			// click time, while the eclipse runs
		released = false,		// whether the samples have been sent back to the prior
		last = performance.now();

	function randn() {
		var u = 1 - Math.random(), v = Math.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * v);
	}

	// Prior: a broad Gaussian over the page.
	function priorMean() { return [W / 2, H / 2]; }
	function priorStd() { return [0.38 * W, 0.42 * H]; }
	function samplePrior() {
		var m = priorMean(), s = priorStd();
		return [m[0] + s[0] * randn(), m[1] + s[1] * randn()];
	}

	// Posterior around the eclipsed sun, as an offset from the logo centre:
	// the angle favours the streamers, the distance past the rim is
	// exponential with a longer tail along them.
	function samplePosterior() {
		var deg;
		if (Math.random() < 0.45) {
			var total = 0, i, pick;
			for (i = 0; i < LOBES.length; i++) total += LOBES[i][2];
			pick = Math.random() * total;
			for (i = 0; i < LOBES.length - 1 && pick > LOBES[i][2]; i++) pick -= LOBES[i][2];
			deg = LOBES[i][0] + randn() * LOBES[i][1] / 2.5;
		}
		else deg = Math.random() * 360;

		var reach = 0.25;
		for (var k = 0; k < LOBES.length; k++) {
			var d = ((deg - LOBES[k][0] + 540) % 360) - 180;
			reach += 2.2 * LOBES[k][2] * Math.exp(-(d * d) / (LOBES[k][1] * LOBES[k][1]));
		}
		var r = R * (1 + 0.015 * randn()) - R * reach * Math.log(1 - Math.random()),
			a = deg * Math.PI / 180;
		return [r * Math.sin(a), -r * Math.cos(a), (r - R) / (R * reach)];
	}

	function build() {
		particles = [];
		for (var i = 0; i < N; i++) {
			var p = samplePrior();
			particles.push({
				x: p[0], y: p[1],
				sx: 0, sy: 0,				// where the current move started
				tx: 0, ty: 0, tail: 0,		// posterior offset from the logo centre, and how far out it is
				nx: randn(), ny: randn(),	// slowly varying noise for the shimmer
				size: 0.9 + 0.8 * Math.random(),
				alpha: 0.22 + 0.33 * Math.random(),
				tw: Math.random() * 6.283, tws: 0.0008 + 0.0016 * Math.random()
			});
		}
	}

	function trackLogo() {
		var r = logo.getBoundingClientRect();
		cx = r.left + r.width / 2;
		cy = r.top + r.height / 2;
		R = r.width / 2;
	}

	function resize() {
		dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		W = window.innerWidth;
		H = window.innerHeight;
		canvas.width = W * dpr;
		canvas.height = H * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		dim = W > 736 ? 1 : 0.75;
		trackLogo();
		if (!particles.length) build();
		if (reduceMotion) draw(0, 0);
	}

	function ease(u) {
		u = Math.max(0, Math.min(1, u));
		return u * u * (3 - 2 * u);
	}

	function startEclipse() {
		eclipse = performance.now();
		released = false;
		for (var i = 0; i < particles.length; i++) {
			var p = particles[i], q = samplePosterior();
			p.sx = p.x; p.sy = p.y;
			p.tx = q[0]; p.ty = q[1]; p.tail = q[2];
		}
	}

	// Where each particle is during the eclipse, and how "posterior" the scene is (0..1).
	function eclipseStep(now) {
		var e = now - eclipse, i, p, u, k;
		if (e < OUT_START) {
			u = ease((e - IN_START) / (IN_END - IN_START));
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				// The noise is annealed away on arrival; a little stays as shimmer.
				k = 14 * 4 * u * (1 - u) + 1.5 * u;
				p.x = p.sx + (cx + p.tx - p.sx) * u + k * p.nx;
				p.y = p.sy + (cy + p.ty - p.sy) * u + k * p.ny;
			}
			return u;
		}
		if (e < OUT_END) {
			if (!released) {
				// Release towards fresh prior samples.
				for (i = 0; i < particles.length; i++) {
					p = particles[i];
					var q = samplePrior();
					p.sx = p.x; p.sy = p.y;
					p.tx = q[0]; p.ty = q[1];
				}
				released = true;
			}
			u = ease((e - OUT_START) / (OUT_END - OUT_START));
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.x = p.sx + (p.tx - p.sx) * u + 10 * 4 * u * (1 - u) * p.nx;
				p.y = p.sy + (p.ty - p.sy) * u + 10 * 4 * u * (1 - u) * p.ny;
			}
			return 1 - u;
		}
		eclipse = null;
		return 0;
	}

	// Langevin dynamics on the prior: x += (eps / 2) * grad log p(x) + sqrt(eps) * noise.
	function priorStep(steps) {
		var m = priorMean(), s = priorStd(),
			ex = steps * EPS / 2, nz = Math.sqrt(steps * EPS);
		for (var i = 0; i < particles.length; i++) {
			var p = particles[i];
			p.x += -ex * (p.x - m[0]) / (s[0] * s[0]) + nz * randn();
			p.y += -ex * (p.y - m[1]) / (s[1] * s[1]) + nz * randn();
		}
	}

	var buckets = [];
	for (var b = 0; b < ALPHA_LEVELS; b++) buckets.push([]);

	function draw(now, post) {
		ctx.clearRect(0, 0, W, H);
		for (var b = 0; b < ALPHA_LEVELS; b++) buckets[b].length = 0;

		for (var i = 0; i < particles.length; i++) {
			var p = particles[i],
				a = p.alpha * (0.8 + 0.2 * Math.sin(now * p.tws + p.tw));
			// In the corona: brighter near the rim, fading along the tail.
			if (post > 0) a += post * (0.55 * Math.exp(-1.2 * p.tail));
			a = Math.max(0, Math.min(0.999, a * dim));
			buckets[Math.floor(a * ALPHA_LEVELS)].push(p.x, p.y, p.size);
		}

		// Cool starlight, warming towards the corona's colour.
		var r = Math.round(225 + 30 * post), g = Math.round(232 + 16 * post), bl = Math.round(255 - 20 * post);
		for (b = 0; b < ALPHA_LEVELS; b++) {
			var list = buckets[b];
			if (!list.length) continue;
			ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bl + ',' + ((b + 0.5) / ALPHA_LEVELS).toFixed(3) + ')';
			for (var q = 0; q < list.length; q += 3)
				ctx.fillRect(list[q] - list[q + 2] / 2, list[q + 1] - list[q + 2] / 2, list[q + 2], list[q + 2]);
		}
	}

	function frame(now) {
		var steps = Math.min(now - last, 50) / 16.7;
		last = now;
		trackLogo();

		// Drift the shimmer noise slowly (Ornstein-Uhlenbeck).
		var rho = Math.exp(-steps / 40), kick = Math.sqrt(1 - rho * rho);
		for (var i = 0; i < particles.length; i++) {
			particles[i].nx = particles[i].nx * rho + kick * randn();
			particles[i].ny = particles[i].ny * rho + kick * randn();
		}

		var post = 0;
		if (eclipse !== null) post = eclipseStep(now);
		else priorStep(steps);

		draw(now, post);
		requestAnimationFrame(frame);
	}

	resize();
	window.addEventListener('resize', resize);
	if (reduceMotion) return;

	logo.addEventListener('click', startEclipse);
	requestAnimationFrame(frame);

})();
