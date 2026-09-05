# Casbin Policy-Based Authorization Migration Guide

## Overview
This guide documents the migration from hardcoded numeric role checks (`checkPermission(level)`) to a centralized, config-driven Casbin policy engine.

## Architecture Changes

### Before (Legacy)
- `checkPermission(minLevel)` middleware with numeric roles: 0=Guest, 1=DJ, 2=Staff, 3=Owner
- Hardcoded in 15+ route handlers
- Roles stored in `roles.json` file

### After (Casbin)
- Resource-action based permissions: `requirePermission(resource, action)`
- Policy defined in `policy.csv` with role inheritance
- Centralized `PermissionService` class
- Admin API for policy management

## File Structure
```
MusicBot/
├── policy.csv                    # Casbin policy (source of truth)
├── src/
│   ├── auth/
│   │   ├── casbin-model.conf     # Casbin model definition
│   │   ├── casbin.js             # Enforcer singleton & policy CRUD
│   │   ├── permission-service.js # PermissionService class
│   │   └── middleware.js         # Express middleware (requirePermission, optionalAuth)
│   └── api/
│       ├── server.js             # Updated with new middleware & admin API
│       └── routes/
│           ├── music.js          # Updated to use requirePermission
│           ├── karaoke.js        # Updated to use requirePermission
│           ├── system.js         # Updated to use requirePermission
│           └── presets.js        # Updated to use requirePermission
```

## Policy Model (policy.csv)

### Resources & Actions
| Resource  | Actions                    |
|-----------|----------------------------|
| playlist  | create, read, write, delete |
| queue     | read, write                |
| settings  | read, write                |
| karaoke   | read, write                |

### Role Hierarchy (highest to lowest)
```
role:owner → role:admin → role:dj → role:vip → role:user
```

### Permissions by Role
| Role       | playlist                    | queue       | settings | karaoke |
|------------|----------------------------|-------------|----------|---------|
| owner      | create, read, write, delete | read, write | write    | write   |
| admin      | create, read, write         | read, write | -        | write   |
| dj         | read                        | read, write | -        | write   |
| vip        | read, write                 | read        | -        | write   |
| user       | read                        | read        | -        | read    |

## Migration Mapping

### Old → New Permission Checks

| Old Code | New Code |
|----------|----------|
| `checkPermission(3)` | `requirePermission('settings', 'write')` |
| `checkPermission(2)` | `requirePermission('queue', 'write')` or `requirePermission('playlist', 'write')` |
| `checkPermission(1)` | `requirePermission('queue', 'write')` |
| `checkPermission(0)` | `optionalAuth()` (no permission required) |

### Route Updates

#### music.js
| Endpoint | Old | New |
|----------|-----|-----|
| GET /music/player | `checkPermission(0)` | `optionalAuth()` |
| GET /music/queue | `checkPermission(0)` | `optionalAuth()` |
| POST /music/playback | `checkPermission(2)` | `requirePermission('queue', 'write')` |
| POST /music/skip | (none) | `requirePermission('queue', 'write')` |
| POST /music/previous | (none) | `requirePermission('queue', 'write')` |
| POST /music/stop | (none) | `requirePermission('queue', 'write')` |
| POST /music/volume | (none) | `requirePermission('queue', 'write')` |
| POST /music/seek | (none) | `requirePermission('queue', 'write')` |
| GET /music/history | `checkPermission(0)` | `optionalAuth()` |
| POST /music/search | `checkPermission(0)` | `requirePermission('queue', 'write')` |
| POST /music/request | `checkPermission(0)` | `requirePermission('queue', 'write')` |
| POST /queue/reorder | `checkPermission(2)` | `requirePermission('queue', 'write')` |
| DELETE /queue/:index | `checkPermission(0)` + manual check | `optionalAuth()` + manual ownership check |
| POST /player/previous | (none) | `requirePermission('queue', 'write')` |
| POST /queue/shuffle | (none) | `requirePermission('queue', 'write')` |
| GET /library/search | (none) | `optionalAuth()` |

#### karaoke.js
| Endpoint | Old | New |
|----------|-----|-----|
| POST /music/lyrics | (none) | `requirePermission('karaoke', 'read')` |
| POST /karaoke/prepare | (none) | `requirePermission('karaoke', 'write')` |
| POST /music/karaoke | `checkPermission(0)` | `requirePermission('karaoke', 'write')` |
| GET /karaoke/status/:jobId | (none) | `requirePermission('karaoke', 'read')` |
| GET /music/karaoke/pitch-data | (none) | `requirePermission('karaoke', 'read')` |

#### system.js
| Endpoint | Old | New |
|----------|-----|-----|
| GET /bot/status | (none) | public |
| GET /system/settings | (none) | public |
| GET /system/audio-cache | `checkPermission(2)` | `requirePermission('settings', 'read')` |
| POST /api/cache/clean | `checkPermission(2)` | `requirePermission('settings', 'write')` |
| POST /api/settings/session-restore | `checkPermission(3)` | `requirePermission('settings', 'write')` |

#### presets.js
| Endpoint | Old | New |
|----------|-----|-----|
| POST /presets/save | `checkPermission(2)` | `requirePermission('playlist', 'write')` |
| GET /presets | (none) | public |
| POST /presets/load | `checkPermission(2)` | `requirePermission('playlist', 'write')` |
| GET /library/playlists | (none) | public |
| POST /library/playlists/:name | `checkPermission(0)` | `requirePermission('playlist', 'write')` |
| POST /playlist/search | `checkPermission(0)` | `requirePermission('playlist', 'read')` |
| POST /playlist/create | `checkPermission(0)` | `requirePermission('playlist', 'create')` |
| POST /playlist/add | `checkPermission(0)` | `requirePermission('playlist', 'write')` |
| GET /playlist/:id | (none) | public + manual private check |
| GET /playlists | (none) | public |
| DELETE /playlist/:id | `checkPermission(0)` + manual check | `requirePermission('playlist', 'delete')` |
| GET /playlists/my | `checkPermission(0)` | `requirePermission('playlist', 'read')` |
| GET /playlists/public | (none) | public |
| DELETE /library/playlists/:name | `checkPermission(2)` | `requirePermission('playlist', 'delete')` |

## Admin API Endpoints

### Policy Management
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/admin/policies` | `settings:write` | List all policies |
| POST | `/api/admin/policies` | `settings:write` | Add policy (sub, obj, act) |
| DELETE | `/api/admin/policies` | `settings:write` | Remove policy (sub, obj, act) |
| POST | `/api/admin/policies/reload` | `settings:write` | Hot reload policy from CSV |

### Role Assignment
| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/api/admin/roles` | `settings:write` | Assign role to user (userId, role) |
| DELETE | `/api/admin/roles` | `settings:write` | Remove role from user (userId, role) |

## Hot Reload
Policy changes made via admin API or direct CSV edit are automatically saved. Call `POST /api/admin/policies/reload` to reload without restart.

## Default Deny
All permissions are explicit allow. If no policy matches, access is denied.

## Audit Logging
Policy changes via admin API are logged. Extend `casbin.js` to add audit entries for:
- Policy add/remove
- Role assignment add/remove
- Policy reload

## Testing

### Unit Test Example
```javascript
const { newEnforcer } = require('casbin');
const path = require('path');

const enforcer = await newEnforcer(
    path.join(__dirname, 'src/auth/casbin-model.conf'),
    path.join(__dirname, 'policy.csv')
);

// Test explicit permissions
assert(await enforcer.enforce('role:dj', 'queue', 'write') === true);
assert(await enforcer.enforce('role:user', 'queue', 'write') === false);

// Test inheritance
assert(await enforcer.enforce('role:owner', 'playlist', 'delete') === true);
assert(await enforcer.enforce('role:admin', 'queue', 'write') === true);
assert(await enforcer.enforce('role:vip', 'playlist', 'write') === true);
```

## Rollback Plan
If issues arise, the old `checkPermission` function is preserved in `server.js` (commented out). To rollback:
1. Revert `server.js` to use `checkPermission`
2. Revert route files to accept `checkPermission` parameter
3. Restart server

## Adding New Permissions
1. Add policy line to `policy.csv`: `p, role:xxx, resource, action`
2. Add role inheritance if needed: `g, role:xxx, role:yyy`
3. Call `POST /api/admin/policies/reload` or restart
4. Update route handlers with `requirePermission('resource', 'action')`

## Discord Role Mapping
The `PermissionService.getUserRoles()` maps Discord roles to Casbin roles:
- Discord "Admin"/"Staff" → `role:admin`
- Discord "DJ" → `role:dj`
- Discord "VIP"/"Vip" → `role:vip`
- Database VIP flag → `role:vip`
- Owner ID → `role:owner`
- Default → `role:user`

Extend `DISCORD_ROLE_MAP` in `permission-service.js` for new Discord roles.