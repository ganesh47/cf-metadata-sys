'use client'

import {useEffect} from 'react'

const OIDC_CONFIG_URL = 'https://usw2.auth.ac/auth/realms/cf-graphdb/.well-known/openid-configuration'

export default function Home() {
    useEffect(() => {
        const hasSession = document.cookie.includes('session=')

        if (!hasSession) {
            fetch(OIDC_CONFIG_URL)
                .then(res => res.json())
                .then((config:any) => {
                    const clientId = 'cf-graphdb-app'
                    const redirectUri = encodeURIComponent(window.location.origin)
                    window.location.href = `${config.authorization_endpoint}?client_id=${clientId}&response_type=code&scope=openid&redirect_uri=${redirectUri}`
                })
                .catch(err => {
                    console.error('Failed to fetch OIDC config:', err)
                })
        }
    }, [])

    return (
        <main className="min-h-screen flex items-center justify-center">
            <h1 className="text-2xl font-semibold">Welcome to the Graph Canvas</h1>
        </main>
    )
}
