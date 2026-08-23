import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LoginScreen,
})

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message || 'Login failed')
      setIsLoading(false)
    } else {
      window.location.href = '/dashboard'
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Nexcall HRMS</p>
        <h1 id="login-title">Admin login</h1>
        <p className="intro">Sign in to manage employees and attendance.</p>
        
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <label>
            Email address
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required 
              autoFocus
              autoComplete="email"
              placeholder="admin@example.com"
            />
          </label>
          
          <label>
            Password
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
              autoComplete="current-password"
            />
          </label>
          
          <button 
            type="submit" 
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  )
}
