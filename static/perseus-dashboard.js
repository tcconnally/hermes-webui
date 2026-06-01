/**
 * Perseus Dashboard 🪞
 * 
 * Multi-tab dashboard panel with live workspace intelligence:
 *   Context | Services | Memory | Timeline | Tasks
 * 
 * Uses CSS custom properties — adapts to any skin automatically.
 * All features A-F integrated into one cohesive UI.
 */
class PerseusDashboard {
    constructor() {
        this.workspaces = [];
        this.activeWorkspace = null;
        this.activeTab = 'context';
        this.pollInterval = null;
        this.container = null;
        this.collapsed = true;
    }

    async init() {
        this.container = document.createElement('div');
        this.container.id = 'perseus-dashboard';
        this.container.className = 'perseus-dashboard perseus-collapsed';

        this.container.innerHTML = 
            '<div class="pd-header">' +
                '<span class="pd-toggle" id="pd-toggle">🪞</span>' +
                '<span class="pd-title">Perseus</span>' +
                '<select class="pd-ws-select" id="pd-ws-select">' +
                    '<option value="">Discovering...</option>' +
                '</select>' +
                '<span class="pd-status" id="pd-status" title="Dashboard freshness">●</span><button class="pd-coldstart-btn" id="pd-coldstart" title="New session with Perseus context pre-loaded">⚡+Context</button>' +
            '</div>' +
            '<div class="pd-tabs" id="pd-tabs">' +
                '<button class="pd-tab active" data-tab="context">Context</button>' +
                '<button class="pd-tab" data-tab="services">Services</button>' +
                '<button class="pd-tab" data-tab="memory">Memory</button>' +
                '<button class="pd-tab" data-tab="timeline">Timeline</button>' +
                '<button class="pd-tab" data-tab="tasks">Tasks</button>' +
            '</div>' +
            '<div class="pd-body" id="pd-body">' +
                '<div class="pd-tab-content active" id="pd-tab-context">' +
                    '<div class="pd-loading">Loading context...</div>' +
                '</div>' +
                '<div class="pd-tab-content" id="pd-tab-services">' +
                    '<div class="pd-loading">Loading services...</div>' +
                '</div>' +
                '<div class="pd-tab-content" id="pd-tab-memory">' +
                    '<div class="pd-memory-search">' +
                        '<input type="text" class="pd-search-input" id="pd-memory-query" ' +
                            'placeholder="Search memories..." autocomplete="off">' +
                        '<button class="pd-search-btn" id="pd-memory-search-btn">🔍</button>' +
                    '</div>' +
                    '<div class="pd-memory-results" id="pd-memory-results"></div>' +
                '</div>' +
                '<div class="pd-tab-content" id="pd-tab-timeline">' +
                    '<div class="pd-loading">Loading sessions...</div>' +
                '</div>' +
                '<div class="pd-tab-content" id="pd-tab-tasks">' +
                    '<div class="pd-task-filters">' +
                        '<button class="pd-filter active" data-status="">All</button>' +
                        '<button class="pd-filter" data-status="open">Open</button>' +
                        '<button class="pd-filter" data-status="in_progress">Active</button>' +
                        '<button class="pd-filter" data-status="completed">Done</button>' +
                    '</div>' +
                    '<div class="pd-task-list" id="pd-task-list"></div>' +
                '</div>' +
            '</div>';

        var main = document.querySelector('main.main');
        if (main) {
            main.insertBefore(this.container, main.firstChild);
        }

        this._wireEvents();
        await this._loadWorkspaces();
        this._switchTab('context');
        this._startPolling();
        this._pollHealth();
    }

    _wireEvents() {
        var self = this;
        
        // Toggle collapse
        this.container.querySelector('#pd-toggle').addEventListener('click', function() {
            self.collapsed = !self.collapsed;
            self.container.classList.toggle('perseus-collapsed', self.collapsed);
            if (!self.collapsed) self._refreshActiveTab();
        });

        // Workspace selector
        this.container.querySelector('#pd-ws-select').addEventListener('change', function(e) {
            self.activeWorkspace = e.target.value;
            self._refreshActiveTab();
        });

        // Tab switching
        var tabs = this.container.querySelectorAll('.pd-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function(e) {
                self._switchTab(e.target.dataset.tab);
            });
        }

        // Memory search
        var searchBtn = this.container.querySelector('#pd-memory-search-btn');
        var searchInput = this.container.querySelector('#pd-memory-query');
        searchBtn.addEventListener('click', function() { self._searchMemory(); });
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') self._searchMemory();
        });

        // Cold-start button
        var coldBtn = this.container.querySelector('#pd-coldstart');
        coldBtn.addEventListener('click', function() { self._coldStartSession(); });

        // Task filters
        var filters = this.container.querySelectorAll('.pd-filter');
        for (var j = 0; j < filters.length; j++) {
            filters[j].addEventListener('click', function(e) {
                var filters = self.container.querySelectorAll('.pd-filter');
                for (var k = 0; k < filters.length; k++) filters[k].classList.remove('active');
                e.target.classList.add('active');
                self._loadTasks(e.target.dataset.status);
            });
        }
    }

    _switchTab(tab) {
        this.activeTab = tab;
        
        // Update tab buttons
        var tabs = this.container.querySelectorAll('.pd-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
        }
        
        // Update content panels
        var contents = this.container.querySelectorAll('.pd-tab-content');
        for (var j = 0; j < contents.length; j++) {
            contents[j].classList.toggle('active', contents[j].id === 'pd-tab-' + tab);
        }
        
        this._refreshActiveTab();
    }

    _startPolling() {
        var self = this;
        this.pollInterval = setInterval(function() {
            if (!self.collapsed) self._refreshActiveTab();
        }, 30000);
    }

    _refreshActiveTab() {
        switch (this.activeTab) {
            case 'context': this._loadContext(); break;
            case 'services': this._loadServices(); break;
            case 'timeline': this._loadSessions(); break;
            case 'tasks': this._loadTasks(); break;
        }
    }

    async _loadWorkspaces() {
        try {
            var resp = await fetch('/api/perseus/workspaces');
            var data = await resp.json();
            if (data.workspaces && data.workspaces.length) {
                this.workspaces = data.workspaces;
                var select = this.container.querySelector('#pd-ws-select');
                var html = '';
                for (var i = 0; i < data.workspaces.length; i++) {
                    var w = data.workspaces[i];
                    var parts = w.path.split('/');
                    var name = parts.slice(-2).join('/');
                    var branch = w.git_branch || '';
                    var dirty = w.git_dirty ? ' *' : '';
                    var ctxAge = w.context_fresh ? this._formatAge(w.context_fresh) : 'stale';
                    html += '<option value="' + w.path + '">' + name + ' [' + (branch || '?') + dirty + '] ' + ctxAge + '</option>';
                }
                select.innerHTML = html;
                if (!this.activeWorkspace && data.workspaces.length) {
                    this.activeWorkspace = data.workspaces[0].path;
                    select.value = this.activeWorkspace;
                }
            }
        } catch (e) {
            // silent
        }
    }

    // ── A: Context Tab ──
    async _loadContext() {
        var body = document.getElementById('pd-tab-context');
        if (!body) return;
        try {
            var url = '/api/perseus/context' + (this.activeWorkspace ? '?workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            var resp = await fetch(url);
            var data = await resp.json();
            if (data.error) {
                body.innerHTML = '<div class="pd-error">' + this._esc(data.error) + '</div>';
            } else if (data.context) {
                body.innerHTML = this._renderMarkdown(data.context);
            } else {
                body.innerHTML = '<div class="pd-note">' + this._esc(data.context_note || 'No context available') + '</div>';
            }
            this._setStatus('ok');
        } catch (e) {
            body.innerHTML = '<div class="pd-error">Error: ' + this._esc(e.message) + '</div>';
            this._setStatus('error');
        }
    }

    // ── A: Services Tab ──
    async _loadServices() {
        var body = document.getElementById('pd-tab-services');
        if (!body) return;
        try {
            var url = '/api/perseus/services' + (this.activeWorkspace ? '?workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            var resp = await fetch(url);
            var data = await resp.json();
            
            if (data.error) {
                body.innerHTML = '<div class="pd-error">' + this._esc(data.error) + '</div>';
                return;
            }

            var h = '';
            if (data.services && data.services.length) {
                h += '<div class="pd-services-summary">' +
                    '<span class="pd-badge ok">' + (data.healthy || 0) + ' healthy</span> ' +
                    '<span class="pd-badge err">' + (data.unhealthy || 0) + ' down</span>' +
                '</div>';
                h += '<table class="pd-table">' +
                    '<tr><th>Service</th><th>Status</th><th>Probe</th></tr>';
                for (var i = 0; i < data.services.length; i++) {
                    var s = data.services[i];
                    var cls = s.live_status === 'healthy' ? 'svc-ok' : 
                              s.live_status === 'unhealthy' ? 'svc-err' : 'svc-warn';
                    var icon = s.live_status === 'healthy' ? '✅' :
                               s.live_status === 'unhealthy' ? '❌' : '⚠';
                    var probe = s.url || (s.command || '').substring(0, 60);
                    h += '<tr><td>' + this._esc(s.name) + '</td>' +
                        '<td class="' + cls + '">' + icon + ' ' + s.live_status + '</td>' +
                        '<td class="pd-mono">' + this._esc(probe) + '</td></tr>';
                }
                h += '</table>';
            } else {
                h = '<div class="pd-note">No @services configured in context.md</div>';
            }
            body.innerHTML = h;
            this._setStatus('ok');
        } catch (e) {
            body.innerHTML = '<div class="pd-error">Error: ' + this._esc(e.message) + '</div>';
            this._setStatus('error');
        }
    }

    // ── B: Memory Search Tab ──
    async _searchMemory() {
        var input = document.getElementById('pd-memory-query');
        var results = document.getElementById('pd-memory-results');
        var query = input.value.trim();
        
        if (!query) {
            results.innerHTML = '<div class="pd-note">Enter a search query above</div>';
            return;
        }
        
        results.innerHTML = '<div class="pd-loading">Searching...</div>';
        
        try {
            var resp = await fetch('/api/perseus/memory/search?q=' + encodeURIComponent(query) + '&limit=10');
            var data = await resp.json();
            
            if (data.error) {
                results.innerHTML = '<div class="pd-error">' + this._esc(data.error) + '</div>';
                return;
            }
            
            if (!data.results || !data.results.length) {
                results.innerHTML = '<div class="pd-note">No memories found for "' + this._esc(query) + '"</div>';
                return;
            }
            
            var h = '<div class="pd-results-count">' + data.total + ' results</div>';
            for (var i = 0; i < data.results.length; i++) {
                var r = data.results[i];
                var tags = r.tags && r.tags.length ? 
                    r.tags.map(function(t) { return '<span class="pd-tag">' + t + '</span>'; }).join(' ') : '';
                h += '<div class="pd-memory-card">' +
                    '<div class="pd-memory-title">' + this._esc(r.title) + '</div>' +
                    '<div class="pd-memory-snippet">' + r.snippet + '</div>' +
                    '<div class="pd-memory-meta">' + tags + '</div>' +
                '</div>';
            }
            results.innerHTML = h;
        } catch (e) {
            results.innerHTML = '<div class="pd-error">Error: ' + this._esc(e.message) + '</div>';
        }
    }

    // ── C: Session Timeline Tab ──
    async _loadSessions() {
        var body = document.getElementById('pd-tab-timeline');
        if (!body) return;
        try {
            var url = '/api/perseus/sessions?limit=15' + (this.activeWorkspace ? '&workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            var resp = await fetch(url);
            var data = await resp.json();
            
            var h = '';
            
            // Waypoints section
            if (data.waypoints && data.waypoints.length) {
                h += '<h4 class="pd-section-title">🪞 Waypoints</h4>';
                for (var i = 0; i < data.waypoints.length; i++) {
                    var w = data.waypoints[i];
                    h += '<div class="pd-timeline-item waypoint">' +
                        '<span class="pd-timeline-dot wp"></span>' +
                        '<div class="pd-timeline-content">' +
                            '<div class="pd-timeline-title">' + this._esc(w.task || 'Checkpoint') + '</div>' +
                            '<div class="pd-timeline-meta">' + this._esc(w.timestamp || '') + ' · ' + this._esc(w.status || '') + '</div>' +
                        '</div>' +
                    '</div>';
                }
            }
            
            // Sessions
            if (data.sessions && data.sessions.length) {
                h += '<h4 class="pd-section-title">💬 Recent Sessions</h4>';
                for (var j = 0; j < data.sessions.length; j++) {
                    var s = data.sessions[j];
                    var activeDot = s.active ? ' active' : '';
                    h += '<div class="pd-timeline-item' + activeDot + '">' +
                        '<span class="pd-timeline-dot"></span>' +
                        '<div class="pd-timeline-content">' +
                            '<div class="pd-timeline-title">' + this._esc(s.title) + '</div>' +
                            '<div class="pd-timeline-meta">' + 
                                (s.messages || 0) + ' msgs · ' + this._esc(s.model || '') + ' · ' + 
                                this._esc(this._relTime(s.updated)) +
                            '</div>' +
                        '</div>' +
                    '</div>';
                }
            }
            
            if (!h) h = '<div class="pd-note">No sessions or waypoints found</div>';
            body.innerHTML = h;
            this._setStatus('ok');
        } catch (e) {
            body.innerHTML = '<div class="pd-error">Error: ' + this._esc(e.message) + '</div>';
            this._setStatus('error');
        }
    }

    // ── D: Task Radar Tab ──
    async _loadTasks(statusFilter) {
        var body = document.getElementById('pd-task-list');
        if (!body) return;
        try {
            var url = '/api/perseus/tasks' + (this.activeWorkspace ? '?workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            if (statusFilter) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'status=' + statusFilter;
            var resp = await fetch(url);
            var data = await resp.json();
            
            if (data.error) {
                body.innerHTML = '<div class="pd-error">' + this._esc(data.error) + '</div>';
                return;
            }
            
            if (!data.tasks || !data.tasks.length) {
                body.innerHTML = '<div class="pd-note">No tasks found' + (data.note ? ': ' + data.note : '') + '</div>';
                return;
            }
            
            var h = '<div class="pd-task-counts">' +
                '<span class="pd-count open">' + (data.open || 0) + ' open</span> ' +
                '<span class="pd-count active">' + (data.in_progress || 0) + ' active</span> ' +
                '<span class="pd-count done">' + (data.completed || 0) + ' done</span>' +
            '</div>';
            
            for (var i = 0; i < data.tasks.length; i++) {
                var t = data.tasks[i];
                var statusCls = t.status === 'completed' ? 'done' : 
                                t.status === 'in_progress' ? 'active' : 'open';
                h += '<div class="pd-task-card">' +
                    '<div class="pd-task-header">' +
                        '<span class="pd-task-status ' + statusCls + '">' + this._esc(t.status || 'open') + '</span>' +
                        '<span class="pd-task-scope">' + this._esc(t.scope || '') + '</span>' +
                    '</div>' +
                    '<div class="pd-task-title">' + this._esc(t.title) + '</div>' +
                    (t.summary ? '<div class="pd-task-summary">' + this._esc(t.summary) + '</div>' : '') +
                    (t.assignee ? '<div class="pd-task-assignee">👤 ' + this._esc(t.assignee) + '</div>' : '') +
                '</div>';
            }
            body.innerHTML = h;
        } catch (e) {
            body.innerHTML = '<div class="pd-error">Error: ' + this._esc(e.message) + '</div>';
        }
    }

    // ── F: Cold-Start Injection (exposed via API call from session creation) ──
    // The /api/perseus/inject endpoint is called by session creation flow.
    // This method is available for manual injection testing.
    async injectContext() {
        try {
            var url = '/api/perseus/inject' + (this.activeWorkspace ? '?workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            var resp = await fetch(url);
            var data = await resp.json();
            return data.injection;
        } catch (e) {
            return null;
        }
    }

    // ── Helpers ──
    _setStatus(status) {
        var el = document.getElementById('pd-status');
        if (!el) return;
        el.className = 'pd-status ' + status;
        el.title = status === 'ok' ? 'Live' : status === 'error' ? 'Error' : 'Stale';
    }

    _renderMarkdown(md) {
        var h = md;
        h = h.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
        h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
        h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        h = h.replace(/^---$/gm, '<hr>');
        h = h.replace(/\n/g, '<br>');
        return '<div class="pd-context">' + h + '</div>';
    }

    _formatAge(seconds) {
        if (seconds < 60) return Math.round(seconds) + 's';
        if (seconds < 3600) return Math.round(seconds / 60) + 'm';
        if (seconds < 86400) return Math.round(seconds / 3600) + 'h';
        return Math.round(seconds / 86400) + 'd';
    }

    _relTime(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts);
            var now = new Date();
            var diff = (now - d) / 1000;
            if (diff < 60) return 'just now';
            if (diff < 3600) return Math.round(diff / 60) + 'm ago';
            if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
            return Math.round(diff / 86400) + 'd ago';
        } catch (e) { return ''; }
    }

    // ── F: Cold-Start Killer ──
    async _coldStartSession() {
        var btn = document.getElementById('pd-coldstart');
        btn.textContent = '...';
        btn.disabled = true;
        try {
            // Get context injection
            var injUrl = '/api/perseus/inject' + (this.activeWorkspace ? '?workspace=' + encodeURIComponent(this.activeWorkspace) : '');
            var injResp = await fetch(injUrl);
            var injData = await injResp.json();
            
            if (injData.injection) {
                // Store injection for next session creation
                localStorage.setItem('perseus-context-injection', injData.injection);
                localStorage.setItem('perseus-context-workspace', injData.workspace || '');
                
                // Create a new session (use existing WebUI session creation if available)
                // The context will be injected via the session creation flow
                if (typeof window.createSession === 'function') {
                    await window.createSession();
                } else {
                    // Fallback: trigger new session via API
                    var resp = await fetch('/api/session/perseus-new', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            workspace: injData.workspace || this.activeWorkspace || ''
                        })
                    });
                    var data = await resp.json();
                    if (data.session && data.session.session_id) {
                        window.location.href = '/session/' + data.session.session_id;
                    }
                }
                
                btn.textContent = '✓ Session created';
                setTimeout(function() { btn.textContent = '⚡+Context'; btn.disabled = false; }, 2000);
            } else {
                btn.textContent = '⚠ No context';
                setTimeout(function() { btn.textContent = '⚡+Context'; btn.disabled = false; }, 2000);
            }
        } catch (e) {
            btn.textContent = '⚠ Error';
            setTimeout(function() { btn.textContent = '⚡+Context'; btn.disabled = false; }, 2000);
        }
    }

    async _pollHealth() {
        var self = this;
        var status = document.getElementById('pd-status');
        try {
            var resp = await fetch('/api/perseus/health');
            var data = await resp.json();
            if (data.status === 'ok') {
                status.className = 'pd-status ok';
                status.title = 'Perseus healthy';
            } else {
                status.className = 'pd-status warning';
                status.title = data.error || 'Perseus warning';
            }
        } catch(e) {
            status.className = 'pd-status error';
            status.title = 'Perseus unreachable';
        }
        setTimeout(function() { self._pollHealth(); }, 300000);
    }

    _esc(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    window.perseusDashboard = new PerseusDashboard();
    window.perseusDashboard.init();
});
