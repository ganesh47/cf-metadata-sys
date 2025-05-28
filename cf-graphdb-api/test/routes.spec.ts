import { describe, it, expect } from 'vitest'
import { matchRoute, routeMap } from '../src/routes'

describe('matchRoute', () => {
	it('matches static route', () => {
		const result = matchRoute('/auth/callback')
		expect(result).toEqual({ pattern: '/auth/callback', params: {} })
	})

	it('matches org-level route without ID', () => {
		const result = matchRoute('/cf-graphdb/nodes')
		expect(result).toEqual({ pattern: '/:orgId/nodes', params: { orgId: 'cf-graphdb' } })
	})

	it('matches org-level route with node ID', () => {
		const result = matchRoute('/cf-graphdb/nodes/123')
		expect(result).toEqual({ pattern: '/:orgId/nodes/:id', params: { orgId: 'cf-graphdb', id: '123' } })
	})

	it('returns null for non-matching route', () => {
		const result = matchRoute('/invalid/path')
		expect(result).toBeNull()
	})

	it('returns null for incomplete route', () => {
		const result = matchRoute('/')
		expect(result).toBeNull()
	})
})

describe('routeMap', () => {
	it('contains expected paths and methods', () => {
		expect(routeMap['/:orgId/nodes']).toHaveProperty('GET')
		expect(routeMap['/:orgId/nodes']).toHaveProperty('POST')
		expect(routeMap['/:orgId/nodes/:id']).toHaveProperty('GET')
		expect(routeMap['/:orgId/nodes/:id']).toHaveProperty('PUT')
		expect(routeMap['/:orgId/nodes/:id']).toHaveProperty('DELETE')
		expect(routeMap['/auth/callback']).toHaveProperty('GET')
	})
})
