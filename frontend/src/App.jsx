import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import CheckoutVerify from './pages/CheckoutVerify.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/checkout/verify" element={<CheckoutVerify />} />
      <Route path="/admin" element={<AdminDashboard />} />
    </Routes>
  );
}
