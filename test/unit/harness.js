'use strict';

/**
 * A stand-in for n8n's IExecuteFunctions. It records every HTTP request the
 * node makes and answers from a queue of canned responses, so tests can assert
 * exactly what goes over the wire without spending real quota.
 */
const { Ktemia } = require('../../dist/nodes/Ktemia/Ktemia.node.js');
const generic = require('../../dist/nodes/Ktemia/GenericFunctions.js');

/** Waits are recorded instead of slept, so retry tests run instantly. */
const sleeps = [];
generic.timing.sleep = async (ms) => {
	sleeps.push(ms);
};

function makeContext({ params, responses = [], items = 1, continueOnFail = false }) {
	const calls = [];
	const hints = [];
	const queue = [...responses];
	const perItem = Array.isArray(params) ? params : Array.from({ length: items }, () => params);

	const context = {
		getInputData: () => perItem.map(() => ({ json: {} })),
		getNodeParameter(name, itemIndex, fallback) {
			const values = perItem[itemIndex];
			if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Test did not set parameter "${name}"`);
		},
		getNode: () => ({
			id: 'test',
			name: 'Ktemia',
			type: 'n8n-nodes-ktemia.ktemia',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		addExecutionHints: (...added) => hints.push(...added),
		helpers: {
			async httpRequestWithAuthentication(credential, options) {
				calls.push({ credential, ...options });
				const next = queue.shift();
				if (!next) throw new Error(`Unexpected request: ${options.method} ${options.url}`);
				return { statusCode: next.status ?? 200, headers: next.headers ?? {}, body: next.body };
			},
		},
	};
	return { context, calls, hints, queue };
}

async function run(setup) {
	const harness = makeContext(setup);
	sleeps.length = 0;
	const [output] = await new Ktemia().execute.call(harness.context);
	return { ...harness, output, json: output.map((item) => item.json), sleeps: [...sleeps] };
}

/** Run expecting a failure; returns the thrown error plus what was sent. */
async function runError(setup) {
	const harness = makeContext(setup);
	sleeps.length = 0;
	try {
		await new Ktemia().execute.call(harness.context);
	} catch (error) {
		return { ...harness, error, sleeps: [...sleeps] };
	}
	throw new Error('Expected the node to throw');
}

/** A YYYY-MM-DD date `days` from today, so tests never go stale. */
function future(days) {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function apiError(status, code, message = code, param) {
	return {
		status,
		body: { success: false, error: { code, message, ...(param ? { param } : {}) }, data: null },
	};
}

module.exports = { run, runError, future, apiError };
