import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/auth'
import { ToastProvider } from './components/Toast'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'

import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import TaskDetail from './pages/TaskDetail'
import MyTasks from './pages/MyTasks'
import Wallet from './pages/Wallet'
import Withdraw from './pages/Withdraw'
import Dashboard from './pages/admin/Dashboard'
import AdminTasks from './pages/admin/AdminTasks'
import ReviewQueue from './pages/admin/ReviewQueue'
import AdminUsers from './pages/admin/AdminUsers'
import AdminWithdrawals from './pages/admin/AdminWithdrawals'

function Guard({ admin, children }: { admin?: boolean; children: React.ReactNode }) {
  const { session, profile, loading, isAdmin } = useAuth()
  if (loading) return <Spinner label="Đang kiểm tra phiên đăng nhập…" />
  if (!session) return <Navigate to="/dang-nhap" replace />
  if (admin && !isAdmin) return <Navigate to="/" replace />
  if (!admin && profile?.role === 'admin') return <Navigate to="/admin" replace />
  return <>{children}</>
}

function Shell() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dang-nhap" element={<Login />} />
        <Route path="/dang-ky" element={<Register />} />
        <Route path="/nhiem-vu/:id" element={<TaskDetail />} />

        <Route
          path="/cong-viec"
          element={
            <Guard>
              <MyTasks />
            </Guard>
          }
        />
        <Route
          path="/vi"
          element={
            <Guard>
              <Wallet />
            </Guard>
          }
        />

        <Route
          path="/rut-tien"
          element={
            <Guard>
              <Withdraw />
            </Guard>
          }
        />
        <Route
          path="/admin"
          element={
            <Guard admin>
              <Dashboard />
            </Guard>
          }
        />
        <Route
          path="/admin/nhiem-vu"
          element={
            <Guard admin>
              <AdminTasks />
            </Guard>
          }
        />
        <Route
          path="/admin/duyet"
          element={
            <Guard admin>
              <ReviewQueue />
            </Guard>
          }
        />
        <Route
          path="/admin/rut-tien"
          element={
            <Guard admin>
              <AdminWithdrawals />
            </Guard>
          }
        />
        <Route
          path="/admin/nguoi-dung"
          element={
            <Guard admin>
              <AdminUsers />
            </Guard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
