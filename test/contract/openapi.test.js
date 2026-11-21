'use strict';

/**
 * Contract check against the live API spec (network, no key needed).
 *
 * Asserts that every field the node can send exists in
 * https://www.ktemia.com/openapi.json, that every option value is one the spec
 * allows, and that the node covers every operation. Advisory in CI: it needs
 * the network, and a spec change should be read by a person before the node
 * changes.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { Ktemia } = require('../../dist/nodes/Ktemia/Ktemia.node.js');

const SPEC_URL = process.env.KTEMIA_OPENAPI_URL || 'https://www.ktemia.com/openapi.json';

let spec;
const properties = new Ktemia().description.properties;

function resolve(schema) {
	if (!schema) return schema;
	if (schema.$ref) return resolve(spec.components.schemas[schema.$ref.split('/').pop()]);
	if (schema.anyOf) {
		const real = schema.anyOf.find((option) => option.type !== 'null');
		return { ...resolve(real), description: schema.description };
	}
	return schema;
}

function enumOf(schema) {
	const resolved = resolve(schema);
	if (!resolved) return undefined;
	if (resolved.enum) return resolved.enum;
	if (resolved.items) return enumOf(resolved.items);
	return undefined;
}

function bodySchema(path) {
	const ref = spec.paths[path].post.requestBody.content['application/json'].schema;
	return resolve(ref);
}

function queryParams(path) {
	const params = {};
	for (const param of spec.paths[path].get.parameters || []) {
		if (param.in === 'query') params[param.name] = param.schema;
	}
	return params;
}

/** Fields of the node shown for a resource + operation, including inside collections. */
function fieldsFor(resource, operation, collectionName) {
	const shown = properties.filter((property) => {
		const show = property.displayOptions && property.displayOptions.show;
		if (!show) return false;
		if (show.resource && !show.resource.includes(resource)) return false;
		if (show.operation && !show.operation.includes(operation)) return false;
		return true;
	});
	if (!collectionName) return shown;
	const collection = shown.find((property) => property.name === collectionName);
	return collection ? collection.options : [];
}

function optionValues(field) {
	return (field.options || []).map((option) => option.value);
}

// Node field names that are not body fields: UI-only, or folded into another field.
const PASSENGER_FIELDS = new Set(['adults', 'children', 'infantsOnLap']);

before(async () => {
	const response = await fetch(SPEC_URL);
	assert.equal(response.status, 200, `Could not fetch ${SPEC_URL}`);
	spec = await response.json();
});

describe('contract with the live OpenAPI spec', () => {
	it('the node covers every operation in the spec', () => {
		const covered = new Set([
			'GET /flights/airports',
			'GET /flights/airlines',
			'POST /flights/search',
			'GET /flights/results',
			'GET /flights/details',
			'GET /hotels/locations',
			'POST /hotels/search',
			'GET /hotels/results',
			'GET /hotels/details',
			'GET /hotels/reviews',
			'GET /cars/locations',
			'POST /cars/search',
			'GET /cars/results',
			'GET /cars/details',
			'GET /key',
		]);
		const inSpec = [];
		for (const [path, methods] of Object.entries(spec.paths)) {
			for (const method of Object.keys(methods)) inSpec.push(`${method.toUpperCase()} ${path}`);
		}
		const missing = inSpec.filter((operation) => !covered.has(operation));
		assert.deepEqual(missing, [], `Operations in the spec the node does not cover: ${missing.join(', ')}`);
	});

	for (const [resource, path] of [
		['flight', '/flights/search'],
		['hotel', '/hotels/search'],
		['car', '/cars/search'],
	]) {
		it(`${resource} search: every field and option exists in ${path}`, () => {
			const schema = bodySchema(path);
			const uiOnly = ['operation', 'tripType', 'additionalFields', 'legs', 'returnAll', 'limit', 'pagingNotice', 'splitIntoItems'];
			const top = fieldsFor(resource, 'search').filter((field) => !uiOnly.includes(field.name));
			const extra = fieldsFor(resource, 'search', 'additionalFields');
			for (const field of [...top, ...extra]) {
				let target = schema.properties[field.name];
				if (resource === 'flight' && PASSENGER_FIELDS.has(field.name)) {
					target = resolve(schema.properties.passengers).properties[field.name];
				}
				assert.ok(target, `${resource}.${field.name} is not in the spec`);
				const allowed = enumOf(target);
				if (allowed && field.options) {
					for (const value of optionValues(field)) {
						assert.ok(allowed.includes(value), `${resource}.${field.name} offers "${value}", spec allows ${allowed.join(', ')}`);
					}
					assert.deepEqual([...optionValues(field)].sort(), [...allowed].sort(), `${resource}.${field.name} options differ from the spec`);
				}
				const resolved = resolve(target);
				if (resolved && resolved.type === 'integer' && field.options) {
					for (const value of optionValues(field)) {
						if (resolved.minimum !== undefined) assert.ok(value >= resolved.minimum, `${field.name} ${value} below spec minimum`);
						if (resolved.maximum !== undefined) assert.ok(value <= resolved.maximum, `${field.name} ${value} above spec maximum`);
					}
				}
			}
		});
	}

	it('flight legs match TripLeg', () => {
		const legs = fieldsFor('flight', 'search').find((field) => field.name === 'legs');
		const leg = resolve(spec.components.schemas.TripLeg);
		const names = legs.options[0].values.map((value) => value.name).sort();
		assert.deepEqual(names, Object.keys(leg.properties).sort());
	});

	it('carClass is a single value in the spec and in the node', () => {
		const target = bodySchema('/cars/search').properties.carClass;
		assert.notEqual(resolve(target).type, 'array');
		const field = fieldsFor('car', 'search', 'additionalFields').find((f) => f.name === 'carClass');
		assert.equal(field.type, 'options');
	});

	it('no search offers a currency field', () => {
		for (const resource of ['flight', 'hotel', 'car']) {
			const names = fieldsFor(resource, 'search', 'additionalFields').map((field) => field.name);
			assert.ok(!names.includes('currency'), `${resource} search offers currency`);
		}
	});

	it('hotel reviews: every filter and option exists in /hotels/reviews', () => {
		const params = queryParams('/hotels/reviews');
		for (const field of fieldsFor('hotel', 'getReviews', 'reviewFields')) {
			assert.ok(params[field.name], `reviews.${field.name} is not in the spec`);
		}
		const sort = fieldsFor('hotel', 'getReviews', 'reviewFields').find((field) => field.name === 'sortBy');
		assert.deepEqual(optionValues(sort).sort(), [...enumOf(params.sortBy)].sort());
	});

	it('car location type options match LocationType', () => {
		const field = properties.find((property) => property.name === 'locationType');
		assert.deepEqual(optionValues(field).sort(), [...enumOf(queryParams('/cars/locations').type)].sort());
	});

	it('the credential test endpoint GET /key exists', () => {
		assert.ok(spec.paths['/key'] && spec.paths['/key'].get);
	});
});
