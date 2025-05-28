import React from 'react'
import { render, screen } from '@testing-library/react'
import Page from '@/app/page'

describe('Home Page', () => {
    it('Hello from Cloudflare + Next.js!', () => {
        render(<Page />)
        expect(screen.getByText('Hello from Cloudflare + Next.js!')).toBeInTheDocument()
    })
})
