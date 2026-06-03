import { Navigate, Route, Routes } from "react-router-dom"
import AppLayout from "./components/layout/AppLayout"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Library from "./pages/Library"
import Gallery from "./pages/Gallery"
import Studio from "./pages/Studio"
import Montage from "./pages/Montage"
import MontageEditor from "./pages/MontageEditor"
import Channels from "./pages/Channels"
import Admin from "./pages/Admin"
import Onboarding from "./pages/Onboarding"
import Settings from "./pages/Settings"

export default function App() {
  return (
    <Routes>
      <Route path="/login"      element={<Login />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/library"   element={<Library />} />
        <Route path="/gallery"   element={<Gallery />} />
        <Route path="/studio"    element={<Studio />} />
        <Route path="/montage"   element={<Montage />} />
        <Route path="/montage/:id" element={<MontageEditor />} />
        <Route path="/channels"  element={<Channels />} />
        <Route path="/admin"     element={<Admin />} />
        <Route path="/settings"  element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
