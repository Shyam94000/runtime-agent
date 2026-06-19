'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSystemStatus } from '@/lib/api';
import { LayoutDashboard, Stethoscope, Settings, Menu, Activity } from 'lucide-react';

const navItems = [
  {
    label: 'Dashboard',
    href: '/',
    icon: <LayoutDashboard size={18} strokeWidth={2} />,
  },
  {
    label: 'Diagnostics',
    href: '/diagnostics',
    icon: <Stethoscope size={18} strokeWidth={2} />,
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: <Settings size={18} strokeWidth={2} />,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let interval;
    const fetchStatus = async () => {
      try {
        const data = await getSystemStatus();
        setStatus(data);
      } catch {
        setStatus(null);
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusClass = () => {
    if (!status) return 'critical';
    if (!status.monitoring_active) return 'warning';
    return 'healthy';
  };

  const getStatusText = () => {
    if (!status) return 'Disconnected';
    if (!status.monitoring_active) return 'Paused';
    return 'Monitoring Active';
  };

  return (
    <>
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label="Toggle sidebar"
      >
        <Menu size={20} strokeWidth={2} />
      </button>
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <Activity size={28} strokeWidth={2} />
            <span className="sidebar-logo-text">RuntimeAI</span>
          </div>
          <p className="sidebar-tagline">Autonomous Monitoring</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span className="sidebar-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status-dot ${getStatusClass()}`} />
            <span className="sidebar-status-text">{getStatusText()}</span>
          </div>
          {status && (
            <div className="sidebar-stats">
              <div className="sidebar-stat">
                <span className="sidebar-stat-value">{status.anomaly_count || 0}</span>
                <span className="sidebar-stat-label">Anomalies</span>
              </div>
              <div className="sidebar-stat">
                <span className="sidebar-stat-value">{status.diagnostic_count || 0}</span>
                <span className="sidebar-stat-label">Reports</span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
