import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/login')({
  component: LoginScreen,
})

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

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
      // Refresh to ensure server-side token state catches up, then redirect
      window.location.href = '/'
    }
  }

  return (
    <div className="demo-center">
      <div className="demo-panel" style={{ maxWidth: '400px', width: '100%' }}>
        <h1 className="demo-title" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Admin Login</h1>
        
        {error && (
          <div className="demo-alert demo-alert-danger" style={{ marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="demo-section-title" style={{ display: 'block', marginBottom: '0.5rem' }}>Email Address</label>
            <input 
              type="email" 
              className="demo-input" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required 
              autoFocus
              placeholder="admin@example.com"
            />
          </div>
          
          <div>
            <label className="demo-section-title" style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
            <input 
              type="password" 
              className="demo-input" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
          </div>
          
          <button 
            type="submit" 
            className="demo-button" 
            style={{ marginTop: '0.5rem' }}
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
