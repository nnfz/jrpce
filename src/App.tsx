// src/App.tsx - Optimized version (paste relevant sections)

import { useState, useEffect, useRef, useCallback} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Profile } from './components/Profile';
import './App.css';
import { loadConfig, saveConfig, Config, Role } from "./Config";

interface WindowInfo {
  hwnd: string;
  title: string;
  process_name: string;
  icon_path: string;
  display_name: string;
  document_name: string;
}

interface AppConfigItem {
  process_name: string;
  icon_path: string;
  display_name: string;
  app_id?: string;
  title_extract_patterns?: string[];
}

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<WindowInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [appVersion] = useState<string>('0.4.0');

  const [autoCheckInterval, setAutoCheckInterval] = useState<number>(5000);
  const [lastCheckTime, setLastCheckTime] = useState<Date>(new Date());
  const [isAutoChecking, setIsAutoChecking] = useState<boolean>(true);

  const [appsConfig, setAppsConfig] = useState<AppConfigItem[]>([]);

  // Profile state
  const [displayName, setDisplayName] = useState<string>('Your Name');
  const [handleName, setHandleName] = useState<string>('@username');
  const [roles, setRoles] = useState<Role[]>([
    { id: '1', name: 'Developer', color: '#5865f2' },
    { id: '2', name: 'Designer', color: '#eb459e' }
  ]);
  const [activityType, setActivityType] = useState<string>('playing');
  const [removingRoleId, setRemovingRoleId] = useState<string | null>(null);

  // Activity state
  const [activityWindow, setActivityWindow] = useState<WindowInfo | null>(null);
  const [activityPhase, setActivityPhase] = useState<'idle' | 'inHeight' | 'inCard' | 'out'>('idle');
  const [activityTime, setActivityTime] = useState<number>(0);
  const activityWrapRef = useRef<HTMLDivElement>(null);

  const autoCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentAppIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Activity timer
  useEffect(() => {
    if (!activityWindow || activityPhase === 'out') {
      setActivityTime(0);
      return;
    }

    const interval = window.setInterval(() => setActivityTime((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [activityWindow, activityPhase]);

  const formatTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Load allowed processes config once on mount
  useEffect(() => {
    (async () => {
      try {
        const apps = await invoke<AppConfigItem[]>("get_allowed_processes");
        if (Array.isArray(apps)) {
          setAppsConfig(apps);
          console.log('Loaded apps config:', apps.length, 'apps');
        } else {
          console.warn('get_allowed_processes returned non-array');
          setAppsConfig([]);
        }
      } catch (e) {
        console.warn('get_allowed_processes failed:', e);
        setAppsConfig([]);
      }
    })();
  }, []);

  // RPC lifecycle cleanup
  useEffect(() => {
    return () => {
      invoke("close_rpc").catch(() => {});
      currentAppIdRef.current = null;
    };
  }, []);

  // Memoize app config lookup
  const getAppConfig = useCallback((processName: string) => {
    return appsConfig.find(a => a.process_name.toLowerCase() === processName.toLowerCase());
  }, [appsConfig]);

  // Update RPC when activity window changes
  useEffect(() => {
    const updateRpc = async () => {
      try {
        if (!activityWindow) {
          await invoke("clear_rpc").catch(() => {});
          console.log("✅ RPC cleared");
          return;
        }

        // Initialize RPC if needed
        if (!currentAppIdRef.current) {
          const match = getAppConfig(activityWindow.process_name);
          if (match?.app_id) {
            try {
              await invoke("init_rpc", { appId: match.app_id });
              currentAppIdRef.current = match.app_id;
              console.log("✅ RPC initialized:", match.display_name);
            } catch (e) {
              console.error("Failed to init RPC:", e);
              return;
            }
          } else {
            console.warn("No app_id for:", activityWindow.process_name);
            return;
          }
        }

        const stateText = activityWindow.document_name || activityWindow.title || "";
        const sendType = config?.settings?.activityType ?? activityType;

        await invoke("update_rpc", {
          details: "",
          stateText,
          largeImage: "appicon",
          smallImage: "fileicon",
          largeText: "",
          smallText: "",
          activityType: sendType
        });

        console.log("✅ RPC updated:", activityWindow.display_name);
      } catch (err) {
        console.error("❌ RPC update failed:", err);
      }
    };

    updateRpc();
  }, [activityWindow, config, activityType, getAppConfig]);

  // Load config on startup
  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadConfig();
        setConfig(cfg);
        setDisplayName(cfg.profile.displayName);
        setHandleName(cfg.profile.handleName);
        setRoles(cfg.profile.roles);
        setAutoCheckInterval(cfg.settings.autoCheckInterval);
        setIsAutoChecking(cfg.settings.isAutoChecking);
        setActivityType(cfg.settings.activityType ?? 'playing');
      } catch (e) {
        console.error("Failed to load config:", e);
      }
    })();
  }, []);

  // Debounced autosave with timeout
  useEffect(() => {
    if (!config) return;

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save by 1 second
    saveTimeoutRef.current = setTimeout(() => {
      const cfgToSave: Config = {
        profile: { displayName, handleName, roles },
        settings: { autoCheckInterval, isAutoChecking, activityType }
      };
      
      saveConfig(cfgToSave).catch((e) => console.warn("Autosave failed:", e));
      setConfig(cfgToSave);
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [displayName, handleName, roles, autoCheckInterval, isAutoChecking, activityType, config]);

  const loadWindows = useCallback(async () => {
    try {
      const windowsList = await invoke<WindowInfo[]>('get_windows_list');
      const filtered = windowsList.filter((w) => w.document_name?.trim());
      setWindows(filtered);
      setLastCheckTime(new Date());

      // Auto-select first window if none selected
      setSelectedWindow((prev) => {
        if (!prev && filtered.length > 0) {
          const first = filtered[0];
          setActivityWindow(first);
          setActivityPhase('inHeight');
          setTimeout(() => setActivityPhase('inCard'), 100);
          return first;
        }
        return prev;
      });
    } catch (error) {
      console.error('Failed to get windows:', error);
    }
  }, []);

  const applyActivityType = useCallback(async () => {
    try {
      const cfgToSave: Config = {
        profile: { displayName, handleName, roles },
        settings: { autoCheckInterval, isAutoChecking, activityType }
      };

      await saveConfig(cfgToSave);
      setConfig(cfgToSave);

      if (!activityWindow) {
        console.warn("No activityWindow — saved but skipping RPC update");
        return;
      }

      const stateText = activityWindow.document_name || activityWindow.title || "";

      await invoke("update_rpc", {
        details: "",
        stateText,
        largeImage: "appicon",
        smallImage: "fileicon",
        largeText: "",
        smallText: "",
        activityType: cfgToSave.settings.activityType
      });

      console.log("Applied activityType:", cfgToSave.settings.activityType);
    } catch (err) {
      console.error("applyActivityType failed:", err);
      throw err;
    }
  }, [activityType, activityWindow, autoCheckInterval, displayName, handleName, isAutoChecking, roles]);

  const checkWindowsStatus = useCallback(async () => {
    if (windows.length === 0) {
      setLastCheckTime(new Date());
      return;
    }

    const validationPromises = windows.map(async (win) => {
      try {
        const isActive = await invoke<boolean>('is_window_active', { hwnd: parseInt(win.hwnd) });
        return isActive ? win : null;
      } catch {
        return win; // Keep window if check fails
      }
    });

    const results = await Promise.all(validationPromises);
    const updatedWindows = results.filter((w): w is WindowInfo => w !== null);
    
    const hasChanges = updatedWindows.length !== windows.length;
    setLastCheckTime(new Date());

    if (hasChanges) {
      setWindows(updatedWindows);
      
      // Clear selections if window was removed
      if (selectedWindow && !updatedWindows.find(w => w.hwnd === selectedWindow.hwnd)) {
        setSelectedWindow(null);
      }
      if (activityWindow && !updatedWindows.find(w => w.hwnd === activityWindow.hwnd)) {
        setActivityWindow(null);
        setActivityPhase('idle');
      }
    }
  }, [windows, selectedWindow, activityWindow]);

  const manualCheckWindows = async () => {
    setLoading(true);
    const startTime = Date.now();

    try {
      await checkWindowsStatus();
      await loadWindows();
    } catch (error) {
      console.error('Manual check failed:', error);
    } finally {
      setLastCheckTime(new Date());

      const elapsed = Date.now() - startTime;
      const minDelay = 1000;
      if (elapsed < minDelay) {
        setTimeout(() => setLoading(false), minDelay - elapsed);
      } else {
        setLoading(false);
      }
    }
  };

  // Auto-check interval setup
  useEffect(() => {
    if (autoCheckTimerRef.current) {
      clearInterval(autoCheckTimerRef.current);
      autoCheckTimerRef.current = null;
    }

    if (!isAutoChecking || !autoCheckInterval || autoCheckInterval <= 0) {
      return;
    }

    const run = async () => {
      try {
        await checkWindowsStatus();
        await loadWindows();
      } catch (e) {
        console.error("Auto-check failed:", e);
      } finally {
        setLastCheckTime(new Date());
      }
    };

    autoCheckTimerRef.current = window.setInterval(run, autoCheckInterval);

    return () => {
      if (autoCheckTimerRef.current) {
        clearInterval(autoCheckTimerRef.current);
        autoCheckTimerRef.current = null;
      }
    };
  }, [isAutoChecking, autoCheckInterval, checkWindowsStatus, loadWindows]);

  useEffect(() => { loadWindows(); }, [loadWindows]);

  const onWindowClick = async (window: WindowInfo) => {
    try {
      if (selectedWindow?.hwnd === window.hwnd) {
        // Deselect
        setSelectedWindow(null);
        setActivityWindow(null);
        setActivityPhase('out');
        setActivityTime(0);
        await invoke("clear_rpc").catch(() => {});
        await invoke("close_rpc").catch(() => {});
        currentAppIdRef.current = null;
      } else {
        // Select new window
        setSelectedWindow(window);
        setActivityWindow(window);
        setActivityTime(0);
        setActivityPhase('inHeight');
        setTimeout(() => setActivityPhase('inCard'), 100);

        const match = getAppConfig(window.process_name);
        if (match?.app_id) {
          if (currentAppIdRef.current !== match.app_id) {
            await invoke("close_rpc").catch(() => {});
            try {
              await invoke("init_rpc", { appId: match.app_id });
              currentAppIdRef.current = match.app_id;
              console.log("RPC initialized:", match.display_name);
            } catch (e) {
              console.error("init_rpc failed:", e);
            }
          }
        } else {
          console.warn("No app config for:", window.process_name);
        }
      }
    } catch (e) {
      console.error("Failed selecting window:", e);
    }
  };

  const addRole = useCallback(() => {
    const newRole: Role = {
      id: Date.now().toString(),
      name: 'New Role',
      color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
    };
    setRoles(prev => [...prev, newRole]);
  }, []);

  const removeRole = useCallback((id: string) => {
    setRoles(prev => prev.filter(role => role.id !== id));
  }, []);

  const updateRoleName = useCallback((id: string, newName: string) => {
    if (newName.trim()) {
      setRoles(prev => prev.map(role => 
        role.id === id ? { ...role, name: newName.trim() } : role
      ));
    }
  }, []);

  return (
    <>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" />
        <div className="titlebar-title">jrpce</div>
        <div className="titlebar-controls" data-tauri-drag-region="false">
          <button className="tb-btn" aria-label="Minimize" onClick={async () => {
            try {
              const currentWindow = (window as any).__TAURI__?.window?.getCurrent();
              if (currentWindow) {
                await currentWindow.minimize();
              } else {
                await invoke('minimize_window');
              }
            } catch (e) { console.error("Failed to minimize:", e); }
          }}>
            <svg className="tb-icon" viewBox="0 0 24 24" fill="currentColor">
              <path fill="var(--text-feedback-positive)" fillRule="evenodd" clipRule="evenodd" d="M20 14H4v-2h16v2z"/>
            </svg>
          </button>

          <button className="tb-btn" aria-label="Maximize" onClick={async () => {
            try {
              const currentWindow = (window as any).__TAURI__?.window?.getCurrent();
              if (currentWindow) {
                await currentWindow.toggleMaximize();
              } else {
                await invoke('toggle_maximize_window');
              }
            } catch (e) { console.error("Failed to maximize:", e); }
          }}>
            <svg className="tb-icon" viewBox="0 0 24 24" fill="currentColor">
              <path fill="var(--text-feedback-positive)" fillRule="evenodd" clipRule="evenodd" d="M4 4h16v16H4V4zm2 2v12h12V6H6z"/>
            </svg>
          </button>

          <button className="tb-btn close" aria-label="Close" onClick={async () => {
            try {
              const currentWindow = (window as any).__TAURI__?.window?.getCurrent();
              if (currentWindow) {
                await currentWindow.close();
              } else {
                await invoke('close_window');
              }
            } catch (e) { console.error("Failed to close:", e); }
          }}>
            <svg className="tb-icon" viewBox="0 0 24 24" fill="currentColor">
              <path fill="var(--text-feedback-positive)" fillRule="evenodd" clipRule="evenodd" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 
                      10.59 12 5 17.59 6.41 19 12 13.41 
                      17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className='main'>
        <div className="app">
          <Profile 
            displayName={displayName}
            setDisplayName={setDisplayName}
            handleName={handleName}
            setHandleName={setHandleName}
            roles={roles}
            removingRoleId={removingRoleId}
            setRemovingRoleId={setRemovingRoleId}
            addRole={addRole}
            removeRole={removeRole}
            updateRoleName={updateRoleName}
            activityWindow={activityWindow}
            activityPhase={activityPhase}
            activityTime={activityTime}
            formatTime={formatTime}
            activityWrapRef={activityWrapRef}
            activityType={activityType}
            setActivityType={setActivityType}
            onApplyActivityType={applyActivityType} // PROFILE will call apply immediately
          />

          <div className="windows-section">
            <div className="controls">
              <h2>Applications ({windows.length})</h2>
              <div className="controls-right">
                <div className='check-controls'>
                  <div className="auto-check-status">
                    <span className={`status-indicator ${isAutoChecking ? 'active' : 'inactive'}`}></span>
                    <span className="status-text">{isAutoChecking ? 'Auto-checking every:' : 'Auto-check: '}</span>
                    <select 
                      className="interval-selector"
                      value={isAutoChecking ? autoCheckInterval : 0}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (value === 0) {
                          setIsAutoChecking(false);
                        } else {
                          setIsAutoChecking(true);
                          setAutoCheckInterval(value);
                        }
                      }}
                    >
                      <option value={0}>Off</option>
                      <option value={3000}>3s</option>
                      <option value={5000}>5s</option>
                      <option value={10000}>10s</option>
                      <option value={30000}>30s</option>
                    </select>
                  </div>
                  <button onClick={manualCheckWindows} className="btn-apps" disabled={loading}>
                    {loading ? 'Checking...' : 'Check Status'}
                  </button>        
                </div>
              </div>
            </div>

            <div className="last-check-time">Last check: {lastCheckTime.toLocaleTimeString()}</div>

            <div className="windows-list">
              {windows.length === 0 ? (
                <div className="no-windows">{loading ? 'Scanning...' : 'No supported applications found.'}</div>
              ) : (
                windows.map((window, index) => (
                  <div
                    key={`${window.hwnd}-${index}`}
                    onClick={() => onWindowClick(window)}
                    className={`window-item ${selectedWindow?.hwnd === window.hwnd ? 'selected' : ''}`}
                  >
                    <div className="window-header">
                      <img src={window.icon_path} alt="App icon" className="app-icon" />
                    </div>
                    <div className="app-info">
                      <div className="app-name">{window.display_name}</div>
                      {window.document_name && <div className="window-title">{window.document_name}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <footer className="footer">
          <div className="footer-content">
            <div className="footer-left">
              <span className="footer-brand">jrpce</span>
              <span className="footer-version">v{appVersion}</span>
            </div>
            <div className="footer-center"></div>
            <div className="footer-right">
              <div className="footer-links"><a href="http://github.com/nnfz" className="footer-link">GitHub</a></div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

export default App;
