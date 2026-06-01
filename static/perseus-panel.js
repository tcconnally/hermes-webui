/**
 * Perseus Context Panel
 * 
 * Fetches live Perseus workspace context and renders it in the dashboard.
 * Polls /api/perseus/context every 60 seconds.
 */
class PerseusPanel {
    constructor() {
        this.visible = false;
        this.workspaces = [];
        this.activeWorkspace = null;
        this.pollInterval = null;
        this.container = null;
    }

    async init() {
        this.container = document.createElement('div');
        this.container.id = 'perseus-panel';
        this.container.className = 'perseus-panel';
        this.container.innerHTML = `
            <div class="perseus-header">
                <span class="perseus-icon">🪞</span>
                <span class="perseus-title">Perseus Context</span>
                <select class="perseus-ws-select" id="perseus-ws-select">
                    <option value="">Loading...</option>
                </select>
                <span class="perseus-status" id="perseus-status">●</span>
            </div>
            <div class="perseus-body" id="perseus-body">
                <div class="perseus-loading">Loading Perseus context...</div>
            </div>
        `;
        
        const main = document.querySelector('main.main');
        if (main) {
            main.appendChild(this.container);
        }
        
        const select = this.container.querySelector('#perseus-ws-select');
        select.addEventListener('change', (e) => {
            this.activeWorkspace = e.target.value;
            this.refresh();
        });
        
        await this.refresh();
        this.pollInterval = setInterval(() => this.refresh(), 60000);
    }

    async refresh() {
        const status = this.container.querySelector('#perseus-status');
        const body = this.container.querySelector('#perseus-body');
        
        status.className = 'perseus-status loading';
        
        try {
            const url = this.activeWorkspace 
                ? '/api/perseus/context?workspace=' + encodeURIComponent(this.activeWorkspace)
                : '/api/perseus/context';
            
            const resp = await fetch(url);
            const data = await resp.json();
            
            if (data.error) {
                body.innerHTML = '<div class="perseus-error">' + this.escapeHtml(data.error) + '</div>';
                status.className = 'perseus-status error';
                return;
            }
            
            if (data.all_workspaces && data.all_workspaces.length) {
                const select = this.container.querySelector('#perseus-ws-select');
                const current = select.value;
                select.innerHTML = data.all_workspaces.map(function(w) {
                    const name = w.split('/').slice(-2).join('/');
                    const selected = w === current || (!current && w === data.workspace) ? ' selected' : '';
                    return '<option value="' + w + '"' + selected + '>' + name + '</option>';
                }).join('');
                if (!this.activeWorkspace) {
                    this.activeWorkspace = data.workspace;
                }
            }
            
            if (data.context) {
                body.innerHTML = this.renderContext(data.context);
                status.className = 'perseus-status ok';
            } else {
                body.innerHTML = '<div class="perseus-note">' + this.escapeHtml(data.context_note || 'No context available') + '</div>';
                status.className = 'perseus-status warning';
            }
        } catch (e) {
            body.innerHTML = '<div class="perseus-error">Connection error: ' + this.escapeHtml(e.message) + '</div>';
            status.className = 'perseus-status error';
        }
    }

    renderContext(markdown) {
        let html = markdown
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        
        return '<div class="perseus-context">' + html + '</div>';
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    window.perseusPanel = new PerseusPanel();
    window.perseusPanel.init();
});
