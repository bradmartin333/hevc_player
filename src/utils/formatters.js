// Format Utilities - Formatting helpers for time, file size, etc.

export function formatTime(seconds) {
    if (!isFinite(seconds)) return '00:00:00';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format JSON with syntax highlighting and collapsible keys
 * @param {string|object} jsonString - JSON string or object to format
 * @returns {string} HTML string with syntax highlighting
 */
export function formatJSON(jsonString) {
    try {
        const obj = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        // If top-level is an object, render its contents without the outermost braces
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            return formatObject(obj, 0, true, '');
        }

        return formatValue(obj, 0, '');
    } catch (e) {
        return '<span class="json-invalid">Invalid JSON</span>';
    }
}

function formatValue(value, depth, path) {
    if (value === null) {
        return '<span class="json-null">null</span>';
    }

    if (value === undefined) {
        return '<span class="json-undefined">undefined</span>';
    }

    const type = typeof value;

    if (type === 'boolean') {
        return `<span class="json-boolean">${value}</span>`;
    }

    if (type === 'number') {
        return `<span class="json-number">${value}</span>`;
    }

    if (type === 'string') {
        return `<span class="json-string">"${escapeHtml(value)}"</span>`;
    }

    if (Array.isArray(value)) {
        return formatArray(value, depth, path);
    }

    if (type === 'object') {
        return formatObject(value, depth, false, path);
    }

    return escapeHtml(String(value));
}

function formatObject(obj, depth, isRoot = false, path = '') {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
        return '<span class="json-bracket">{}</span>';
    }

    const indent = '  '.repeat(depth);
    const nextIndent = '  '.repeat(depth + 1);
    const id = 'obj-' + Math.random().toString(36).substring(2, 11);

    // Check if this path should be expanded
    const isExpanded = window.expandedJSONPaths && window.expandedJSONPaths.has(path);
    const displayStyle = isExpanded ? '' : 'none';
    const buttonText = isExpanded ? '-' : '+';

    // isRoot parameter indicates caller requested omission of outer braces

    let html = '';
    if (!isRoot) {
        html += `<span class="json-bracket">{</span>`;
        html += `<span class="json-collapsible" data-id="${id}">`;
        html += `<button class="json-toggle" onclick="toggleJSON('${id}')">${buttonText}</button>`;
        html += `<div class="json-content" id="${id}" data-json-path="${escapeHtml(path)}" style="display: ${displayStyle};">`;
    } else {
        html += `<div class="json-content root-json-content" id="${id}" data-json-path="${escapeHtml(path)}">`;
    }

    keys.forEach((key, index) => {
        const keyPath = path ? `${path}.${key}` : key;
        html += `\n${nextIndent}<span class="json-key">"${escapeHtml(key)}"</span>: `;
        html += formatValue(obj[key], depth + 1, keyPath);
        if (index < keys.length - 1) {
            html += '<span class="json-punctuation">,</span>';
        }
    });

    html += `\n${indent}</div>`;
    if (!isRoot) {
        html += `</span>`;
        html += `<span class="json-bracket">}</span>`;
    }

    return html;
}

function formatArray(arr, depth, path) {
    if (arr.length === 0) {
        return '<span class="json-bracket">[]</span>';
    }

    const indent = '  '.repeat(depth);
    const nextIndent = '  '.repeat(depth + 1);
    const id = 'arr-' + Math.random().toString(36).substring(2, 11);

    // Check if this path should be expanded
    const isExpanded = window.expandedJSONPaths && window.expandedJSONPaths.has(path);
    const displayStyle = isExpanded ? '' : 'none';
    const buttonText = isExpanded ? '-' : '+';

    let html = `<span class="json-bracket">[</span>`;
    html += `<span class="json-collapsible" data-id="${id}">`;
    html += `<button class="json-toggle" onclick="toggleJSON('${id}')">${buttonText}</button>`;
    html += `<div class="json-content" id="${id}" data-json-path="${escapeHtml(path)}" style="display: ${displayStyle};">`;

    arr.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        html += `\n${nextIndent}`;
        html += formatValue(item, depth + 1, itemPath);
        if (index < arr.length - 1) {
            html += '<span class="json-punctuation">,</span>';
        }
    });

    html += `\n${indent}</div></span>`;
    html += `<span class="json-bracket">]</span>`;

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
