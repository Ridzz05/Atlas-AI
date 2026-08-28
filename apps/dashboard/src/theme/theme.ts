'use client';
import { createTheme, responsiveFontSizes } from '@mui/material/styles';

let theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#fbf8f2', // Smooth Warm Vanilla Canvas
      paper: '#ffffff'   // Pure Crisp White Cards
    },
    primary: {
      main: '#ff4f00',   // Zapier Electric Orange
      light: '#ff6d29',
      dark: '#d64200',
      contrastText: '#ffffff'
    },
    secondary: {
      main: '#201515',   // Deep Coffee Ink
      light: '#362a2a',
      dark: '#120c0c',
      contrastText: '#ffffff'
    },
    success: {
      main: '#16a34a',
      light: '#22c55e',
      dark: '#15803d',
      contrastText: '#ffffff'
    },
    warning: {
      main: '#ff4f00',
      light: '#ff6d29',
      dark: '#d64200',
      contrastText: '#ffffff'
    },
    error: {
      main: '#dc2626',
      light: '#ef4444',
      dark: '#b91c1c',
      contrastText: '#ffffff'
    },
    info: {
      main: '#2563eb',
      light: '#3b82f6',
      dark: '#1d4ed8',
      contrastText: '#ffffff'
    },
    text: {
      primary: '#201515',   // Deep Coffee Ink text
      secondary: '#666155', // Warm Muted Body
      disabled: '#a8a29e'
    },
    divider: 'rgba(32, 21, 21, 0.08)'
  },
  typography: {
    fontFamily: [
      'Inter',
      'system-ui',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      'sans-serif'
    ].join(','),
    h1: { fontWeight: 700, letterSpacing: '-0.025em', color: '#201515' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em', color: '#201515' },
    h3: { fontWeight: 700, letterSpacing: '-0.015em', color: '#201515' },
    h4: { fontWeight: 600, letterSpacing: '-0.01em', color: '#201515' },
    h5: { fontWeight: 700, color: '#201515' },
    h6: { fontWeight: 700, color: '#201515' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' }
  },
  shape: {
    borderRadius: 14
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#fbf8f2',
          color: '#201515',
          scrollbarColor: '#d6cec2 #fbf8f2',
          '&::-webkit-scrollbar': {
            width: '6px',
            height: '6px'
          },
          '&::-webkit-scrollbar-track': {
            background: '#fbf8f2'
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#d6cec2',
            borderRadius: '10px'
          }
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid rgba(32, 21, 21, 0.08)',
          boxShadow: '0 2px 8px rgba(32, 21, 21, 0.04)'
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#ffffff',
          borderRadius: 16,
          border: '1px solid rgba(32, 21, 21, 0.08)',
          boxShadow: '0 2px 8px rgba(32, 21, 21, 0.04)',
          transform: 'none !important',
          transition: 'border-color 0.15s ease-in-out',
          '&:hover': {
            borderColor: 'rgba(255, 79, 0, 0.35)',
            transform: 'none !important'
          }
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: '8px 18px',
          fontWeight: 600,
          fontSize: '0.88rem',
          transform: 'none !important',
          transition: 'background-color 0.15s ease-in-out, border-color 0.15s ease-in-out',
          '&:active': {
            transform: 'none !important'
          },
          '&:hover': {
            transform: 'none !important'
          }
        },
        contained: {
          backgroundColor: '#ff4f00',
          color: '#ffffff',
          boxShadow: 'none',
          '&:hover': {
            backgroundColor: '#ff6d29',
            boxShadow: 'none',
            transform: 'none !important'
          }
        },
        outlined: {
          borderColor: 'rgba(32, 21, 21, 0.15)',
          backgroundColor: '#ffffff',
          color: '#201515',
          boxShadow: 'none',
          '&:hover': {
            borderColor: '#ff4f00',
            backgroundColor: '#fff9f5',
            color: '#ff4f00',
            boxShadow: 'none',
            transform: 'none !important'
          }
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 8
        },
        filled: {
          backgroundColor: '#f3ede2',
          color: '#201515'
        },
        outlined: {
          borderColor: 'rgba(32, 21, 21, 0.15)',
          backgroundColor: '#ffffff',
          color: '#201515'
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(32, 21, 21, 0.06)',
          color: '#201515'
        },
        head: {
          color: '#666155',
          fontWeight: 600,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          backgroundColor: '#f5efe6'
        }
      }
    }
  }
});

theme = responsiveFontSizes(theme);

export default theme;
