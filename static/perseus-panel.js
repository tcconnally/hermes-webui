/**
 * Perseus Context Panel 🪞
 * 
 * Live workspace context in the dashboard. Reads rendered .hermes.md
 * files kept fresh by Perseus cron. Polls every 30 seconds.
 * 
 * Uses CSS custom properties so it auto-adapts to any skin.
 */
class PerseusPanel {
    constructor() {
        this.workspaces = [];
        this.activeWorkspace = null;
        this.pollInterval = null;
        this.container = null;
        this.collapsed = true;
    }

    async init() {
        this.container = document.createElement('div');
        this.container.id = 'perseus-panel';
        this.container.className = 'perseus-panel perseus-collapsed';
        this.container.innerHTML = ''
            + '<div class="perseus-header">'
            +   '<span class="perseus-toggle" id="perseus-toggle">🪞</span>'
            +   '<span class="perseus-title">Perseus</span>'
            +   '<select class="perseus-ws-select" id="perseus-ws-select">'
            +     '<option value="">Discovering...</option>'
            +   '</select>'
            +   '<span class="perseus-status" id="perseus-status" title="Context freshness">●</span>'
            + '</div>'
            + '<div class="perseus-body" id="perseus-body">'
            +   '<div class="perseus-loading">Loading workspace context...</div>'
            + '</div>';

        const main = document.querySelector('main.main');
        if (main) {
            main.insertBefore(this.container, main.firstChild);
        }

        // Toggle collapse
        const toggle = this.container.querySelector('#perseus-toggle');
        toggle.addEventListener('click', () => {
            this.collapsed = !this.collapsed;
            this.container.classList.toggle('perseus-collapsed', this.collapsed);
            if (!this.collapsed) this.refresh();
        });

        const select = this.container.querySelector('#perseus-ws-select');
        select.addEventListener('change', (e) => {
            this.activeWorkspace = e.target.value;
            this.refresh();
        });

        await this.refresh();
        this.pollInterval = setInterval(() => {
            if (!this.collapsed) this.refresh();
        }, 30000);
    }

    async refresh() {
        const status = this.container.querySelector('#perseus-status');
        const body = this.container.querySelector('#perseus-body');
        if (!body) return;
        
        status.className = 'perseus-status loading';
        
        try {
            const url = this.activeWorkspace 
                ? '/api/perseus/context?workspace=' + encodeURIComponent(this.activeWorkspace)
                : '/api/perseus/context';
            
            const resp = await fetch(url);
            const data = await resp.json();
            
            if (data.error) {
                body.innerHTML = '<div class="perseus-error">'
                    + this.escapeHtml(data.error) + '</div>';
                status.className = 'perseus-status error';
                return;
            }
            
            // Update workspace dropdown
            if (data.all_workspaces && data.all_workspaces.length) {
                const select = this.container.querySelector('#perseus-ws-select');
                const current = select.value;
                let opts = '';
                for (let i = 0; i < data.all_workspaces.length; i++) {
                    const w = data.all_workspaces[i];
                    const parts = w.split('/');
                    const name = parts.slice(-2).join('/');
                    const sel = (w === current || (!current && w === data.workspace)) 
                        ? ' selected' : '';
                    opts += '<option value="' + w + '"' + sel + '>' + name + '</option>';
                }
                select.innerHTML = opts;
                if (!this.activeWorkspace) this.activeWorkspace = data.workspace;
            }
            
            // Render context
            if (data.context) {
                body.innerHTML = this.renderMarkdown(data.context);
                status.className = 'perseus-status ok';
                status.title = 'Context fresh';
            } else if (data.context_note) {
                body.innerHTML = '<div class="perseus-note">'
                    + this.escapeHtml(data.context_note) + '</div>';
                status.className = 'perseus-status warning';
                status.title = 'No rendered context';
            }
        } catch (e) {
            body.innerHTML = '<div class="perseus-error">Connection error: '
                + this.escapeHtml(e.message) + '</div>';
            status.className = 'perseus-status error';
        }
    }

    renderMarkdown(md) {
        var h = md;
        // Headers
        h = h.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
        h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        // Code blocks
        h = h.replace(/```(\w*)\n([\s\S]*?)```/g,
            '<pre><code>$2</code></pre>');
        // Inline code
        h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic
        h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Service table rows — highlight status
        h = h.replace(
            /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g,
            function(m, name, status, latency) {
                var cls = '';
                if (status.indexOf('✅') >= 0) cls = ' class="svc-ok"';
                else if (status.indexOf('❌') >= 0) cls = ' class="svc-err"';
                else if (status.indexOf('⚠') >= 0) cls = ' class="svc-warn"';
                return '<tr><td>' + name.trim()
                    + '</td><td' + cls + '>' + status.trim()
                    + '</td><td>' + (latency||'').trim() + '</td></tr>';
            });
        // Blockquotes
        h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        // Horizontal rules
        h = h.replace(/^---$/gm, '<hr>');
        // Line breaks
        h = h.replace(/\n/g, '<br>');
        
        return '<div class="perseus-context">' + h + '</div>';
    }

    escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    window.perseusPanel = new PerseusPanel();
    window.perseusPanel.init();
});
