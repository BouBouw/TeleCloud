import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { authApi } from '../lib/api'
import type { User } from '../lib/api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('ss_token')
    if (!token) { setLoading(false); return }
    authApi.me()
      .then(({ user }) => setUser(user))
      .catch(() => localStorage.removeItem('ss_token'))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    localStorage.setItem('ss_token', data.accessToken)
    if (data.refreshToken) localStorage.setItem('ss_refresh', data.refreshToken)
    setUser(data.user)
  }

  const register = async (email: string, password: string, displayName: string) => {
    const data = await authApi.register(email, password, displayName)
    localStorage.setItem('ss_token', data.accessToken)
    setUser(data.user)
  }

  const logout = () => {
    const rt = localStorage.getItem('ss_refresh') ?? undefined
    authApi.logout(rt).catch(() => {})
    localStorage.removeItem('ss_token')
    localStorage.removeItem('ss_refresh')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
