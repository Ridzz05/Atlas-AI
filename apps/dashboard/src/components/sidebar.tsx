'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import {
  LayoutDashboard,
  CheckSquare,
  MessageSquare,
  Users,
  Brain,
  ShieldCheck,
  FileText,
  Activity,
  Settings,
  Zap
} from 'lucide-react';

const NAV_ITEMS = [
  { name: 'Command Center', href: '/', icon: LayoutDashboard },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Communications', href: '/communications', icon: MessageSquare },
  { name: 'Agent Fleet', href: '/agents', icon: Users },
  { name: 'Second Brain', href: '/brain', icon: Brain, badge: 'RAG' },
  { name: 'Approvals', href: '/approvals', icon: ShieldCheck },
  { name: 'Artifacts', href: '/artifacts', icon: FileText },
  { name: 'Audit & Telemetry', href: '/audit', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <Box
      component="aside"
      sx={{
        width: 268,
        height: '100vh',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        bgcolor: '#f5efe6', // Soft Warm Vanilla Sidebar
        borderRight: '1px solid rgba(32, 21, 21, 0.08)',
        boxShadow: 'none',
        zIndex: 20
      }}
    >
      <Box>
        {/* Brand Header */}
        <Box
          sx={{
            p: 2.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            borderBottom: '1px solid rgba(32, 21, 21, 0.06)'
          }}
        >
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: '#ff4f00',
              color: '#ffffff',
              fontWeight: 800,
              width: 36,
              height: 36,
              borderRadius: '10px'
            }}
          >
            _
          </Avatar>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: '0.02em', color: '#201515' }}>
              ATLAS AI OS
            </Typography>
            <Typography variant="caption" sx={{ color: '#8c827a', fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 600 }}>
              VANILLA WORKFLOWS
            </Typography>
          </Box>
        </Box>

        {/* Navigation List */}
        <List sx={{ px: 1.5, py: 2 }} component="nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <ListItemButton
                key={item.href}
                component={Link}
                href={item.href}
                selected={isActive}
                sx={{
                  borderRadius: '10px',
                  mb: 0.75,
                  py: 1,
                  px: 1.5,
                  color: isActive ? '#201515' : '#666155',
                  bgcolor: isActive ? '#ffffff' : 'transparent',
                  border: isActive ? '1px solid rgba(32, 21, 21, 0.1)' : '1px solid transparent',
                  '&:hover': {
                    bgcolor: isActive ? '#ffffff' : '#ece5dc',
                    color: '#201515'
                  }
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 30,
                    color: isActive ? '#ff4f00' : '#8c827a'
                  }}
                >
                  <Icon size={18} />
                </ListItemIcon>
                <ListItemText
                  primary={item.name}
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: '0.84rem',
                        fontWeight: isActive ? 700 : 500
                      }
                    }
                  }}
                />
                {item.badge && (
                  <Chip
                    label={item.badge}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      bgcolor: '#ff4f00',
                      color: '#ffffff'
                    }}
                  />
                )}
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      {/* Safety Notice Card */}
      <Box sx={{ p: 2, borderTop: '1px solid rgba(32, 21, 21, 0.06)' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            p: 1.75,
            borderRadius: '12px',
            bgcolor: '#ffffff',
            border: '1px solid rgba(32, 21, 21, 0.08)',
            color: '#201515'
          }}
        >
          <Zap size={16} style={{ flexShrink: 0, marginTop: 2, color: '#ff4f00' }} />
          <Typography variant="caption" sx={{ fontSize: '0.72rem', lineHeight: 1.4, color: '#666155', fontWeight: 500 }}>
            Automated loop execution synced via durable workflow orchestrator.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
