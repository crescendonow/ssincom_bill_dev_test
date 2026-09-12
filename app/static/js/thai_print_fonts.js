(function() {
    'use strict';

    var fontFaces = [
        '16px "TH Sarabun New"',
        'bold 16px "TH Sarabun New"',
        'italic 16px "TH Sarabun New"',
        'italic bold 16px "TH Sarabun New"'
    ];
    var fontSources = [
        ['url("/static/fonts/THSarabunNew.ttf")', { weight: 'normal', style: 'normal' }],
        ['url("/static/fonts/THSarabunNew%20Bold.ttf")', { weight: 'bold', style: 'normal' }],
        ['url("/static/fonts/THSarabunNew%20Italic.ttf")', { weight: 'normal', style: 'italic' }],
        ['url("/static/fonts/THSarabunNew%20BoldItalic.ttf")', { weight: 'bold', style: 'italic' }]
    ];
    var retrySequence = 0;
    var recoveredFaces = [];

    function recoverFailedFaces() {
        if (!document.fonts) return Promise.resolve(false);
        if (recoveredFaces.length && recoveredFaces.every(function(face) { return face.status === 'loaded'; })) {
            return Promise.resolve(true);
        }
        var failed = Array.from(document.fonts).filter(function(face) {
            return face.family === 'TH Sarabun New' && face.status === 'error';
        });
        if (!failed.length) return Promise.resolve(false);

        var existing = new Set(document.fonts);
        var token = Date.now() + '-' + (++retrySequence);
        var style = document.createElement('style');
        style.dataset.thaiFontRetry = token;
        style.textContent = fontSources.map(function(entry) {
            var source = entry[0].replace('")', '?retry=' + token + '")');
            var descriptors = entry[1];
            return '@font-face { font-family: "TH Sarabun New"; src: ' + source + '; font-weight: ' + descriptors.weight + '; font-style: ' + descriptors.style + '; }';
        }).join('\n');
        document.head.appendChild(style);

        var added = Array.from(document.fonts).filter(function(face) {
            return !existing.has(face) && face.family === 'TH Sarabun New';
        });
        if (added.length < 4) return Promise.reject(new Error('Thai print font retry faces were not registered.'));
        return Promise.all(added.map(function(face) { return face.load(); })).then(function() {
            if (added.filter(function(face) { return face.status === 'loaded'; }).length < 4) {
                throw new Error('Thai print font retry did not load all styles.');
            }
            recoveredFaces = added;
            return true;
        });
    }

    function ready() {
        if (!document.fonts || !document.fonts.load || !document.fonts.ready) {
            return Promise.reject(new Error('Font loading is unavailable in this browser.'));
        }
        var timeoutId;
        var timeout = new Promise(function(_, reject) {
            timeoutId = window.setTimeout(function() {
                reject(new Error('Thai print fonts did not finish loading.'));
            }, 10000);
        });
        var loading = recoverFailedFaces().then(function(recovered) {
            if (recovered) return;
            var sample = '\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22';
            return Promise.all(fontFaces.map(function(font) {
                return document.fonts.load(font, sample);
            })).then(function() { return document.fonts.ready; });
        });
        return Promise.race([loading, timeout]).finally(function() {
            window.clearTimeout(timeoutId);
        });
    }

    window.ThaiPrintFonts = { ready: ready };
})();