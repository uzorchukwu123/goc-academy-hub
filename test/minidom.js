/* minidom.js — a very small DOM stand-in, only as clever as these tests need.
   There is no jsdom in this sandbox and no network to fetch one, so the app's
   render functions are exercised against this instead of being eyeballed.
   It understands: elements with attributes, classList, textContent, an
   innerHTML setter that parses the markup the app actually writes, appendChild,
   and querySelectorAll for '#id', '.class', 'tag' and 'tag[attr=value]'
   with descendant combinators. Anything beyond that is deliberately absent. */
'use strict';

function ClassList(el) { this.el = el; }
ClassList.prototype._parts = function () {
  return String(this.el.className || '').split(/\s+/).filter(Boolean);
};
ClassList.prototype._set = function (a) { this.el.className = a.join(' '); };
ClassList.prototype.contains = function (c) { return this._parts().indexOf(c) > -1; };
ClassList.prototype.add = function (c) { var a = this._parts(); if (a.indexOf(c) < 0) a.push(c); this._set(a); };
ClassList.prototype.remove = function (c) { this._set(this._parts().filter(function (x) { return x !== c; })); };
ClassList.prototype.toggle = function (c, on) {
  if (on === undefined) on = !this.contains(c);
  if (on) this.add(c); else this.remove(c);
  return !!on;
};

function El(tag, attrs) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.attributes = {};
  this.className = '';
  this.classList = new ClassList(this);
  this.style = {};
  this.dataset = {};
  this.hidden = false;
  this.checked = false;
  this.disabled = false;
  this.value = '';
  this._text = '';
  var self = this;
  Object.keys(attrs || {}).forEach(function (k) { self.setAttribute(k, attrs[k]); });
}
El.prototype.setAttribute = function (k, v) {
  this.attributes[k] = String(v);
  if (k === 'class') this.className = String(v);
  if (k === 'id') this.id = String(v);
  if (k === 'type') this.type = String(v);
  if (k === 'value') this.value = String(v);
  if (k === 'checked') this.checked = true;
  if (k === 'hidden') this.hidden = true;
  if (k === 'disabled') this.disabled = true;
};
El.prototype.getAttribute = function (k) {
  if (k === 'class') return this.className;
  return this.attributes[k] === undefined ? null : this.attributes[k];
};
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.focus = function () { this.focused = true; };
El.prototype.scrollIntoView = function () { this.scrolled = true; };
El.prototype.addEventListener = function () {};
El.prototype.closest = function (sel) {
  var n = this;
  while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
  return null;
};

Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    if (this.children.length) {
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
    return this._text;
  },
  set: function (v) { this.children = []; this._html = undefined; this._text = String(v == null ? '' : v); }
});

Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () {
    /* Elements built with appendChild have no source markup, so serialise the
       children instead — otherwise a test could not tell an empty list from a
       list built the programmatic way. */
    if (this.children.length) {
      return this.children.map(function (c) { return c.outerHTML; }).join('');
    }
    return this._html === undefined ? this._text : this._html;
  },
  set: function (v) {
    this._html = String(v == null ? '' : v);
    this._text = '';
    this.children = parse(this._html, this);
  }
});

Object.defineProperty(El.prototype, 'outerHTML', {
  get: function () {
    if (this.tagName === '#TEXT') return this._text;
    var t = this.tagName.toLowerCase(), self = this, at = '';
    Object.keys(this.attributes).forEach(function (k) {
      if (k === 'class') return;
      at += ' ' + k + '="' + String(self.attributes[k]) + '"';
    });
    if (this.className) at = ' class="' + this.className + '"' + at;
    if (VOID[t]) return '<' + t + at + '>';
    return '<' + t + at + '>' + this.innerHTML + '</' + t + '>';
  }
});

/* ---- the smallest parser that copes with what the app writes ---- */
var VOID = { br: 1, img: 1, input: 1, hr: 1, meta: 1, link: 1, use: 1, path: 1 };
function parse(html, owner) {
  var root = { children: [] }, stack = [root];
  var re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g, m;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      var txt = m[3];
      if (txt.trim()) {
        var top = stack[stack.length - 1];
        // Text becomes a node of its own, so an element can hold both text and
        // children without either being lost on the way back out. Text at the
        // top level of a fragment belongs to the element being filled, so it is
        // kept too — otherwise '<b>Heading</b> and the rest' would lose the rest.
        var tn = new El('#text');
        tn._text = decode(txt);
        if (top === root) { tn.parentNode = owner || null; root.children.push(tn); }
        else {
          top.appendChild(tn);
          // A browser treats the text inside a textarea as its default value;
          // the console's forms rely on that to show what is being edited.
          if (top.tagName === 'TEXTAREA') top.value = String(top.value || '') + decode(txt);
        }
      }
      continue;
    }
    var tag = m[1].toLowerCase();
    var closing = m[0].charAt(1) === '/';
    if (closing) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    var el = new El(tag, attrsOf(m[2] || ''));
    var parent = stack[stack.length - 1];
    if (parent === root) { el.parentNode = owner || null; root.children.push(el); }
    else parent.appendChild(el);
    if (!VOID[tag] && m[0].slice(-2) !== '/>') stack.push(el);
  }
  root.children.forEach(function (n) { fixSelect(n); walk(n, fixSelect); });
  return root.children;
}
/* A <select> reports the value of its selected option — or of the first one when
   none is marked — and an <option> with no value attribute reports its own text.
   The console's forms are read back through exactly that behaviour. */
function fixSelect(el) {
  if (el.tagName !== 'SELECT') return;
  var opts = [];
  walk(el, function (c) { if (c.tagName === 'OPTION') opts.push(c); });
  if (!opts.length) return;
  var chosen = null;
  opts.forEach(function (o) {
    if (o.attributes.value === undefined) o.value = String(o.textContent);
    if (o.getAttribute('selected') !== null) chosen = o;
  });
  el.value = String((chosen || opts[0]).value || '');
}
function attrsOf(s) {
  var out = {}, re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))|([\w:-]+)/g, m;
  while ((m = re.exec(s))) {
    if (m[6]) out[m[6]] = m[6];
    else out[m[1]] = decode(m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]));
  }
  return out;
}
function decode(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* ---- selectors ---- */
function matches(el, sel) {
  var parts = String(sel).trim().match(/^([a-zA-Z*]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!parts) return false;
  if (parts[1] && parts[1] !== '*' && el.tagName !== parts[1].toUpperCase()) return false;
  var rest = parts[2] || '', re = /[.#][\w-]+|\[[^\]]+\]/g, m;
  while ((m = re.exec(rest))) {
    var t = m[0];
    if (t.charAt(0) === '.') { if (!el.classList.contains(t.slice(1))) return false; }
    else if (t.charAt(0) === '#') { if (el.id !== t.slice(1)) return false; }
    else {
      var kv = t.slice(1, -1).split('=');
      var k = kv[0].trim(), v = (kv[1] || '').trim().replace(/^["']|["']$/g, '');
      var got = el.getAttribute(k);
      if (kv.length === 1 ? got === null : String(got) !== v) return false;
    }
  }
  return true;
}
function walk(node, fn) {
  (node.children || []).forEach(function (c) { fn(c); walk(c, fn); });
}
function queryAll(root, sel) {
  var out = [];
  String(sel).split(',').forEach(function (one) {
    var steps = one.trim().split(/\s+/);
    var current = [root];
    steps.forEach(function (step) {
      var next = [];
      current.forEach(function (ctx) {
        walk(ctx, function (el) { if (matches(el, step) && next.indexOf(el) < 0) next.push(el); });
      });
      current = next;
    });
    current.forEach(function (el) { if (out.indexOf(el) < 0) out.push(el); });
  });
  return out;
}
El.prototype.querySelectorAll = function (sel) { return queryAll(this, sel); };
El.prototype.querySelector = function (sel) { return queryAll(this, sel)[0] || null; };

/* ---- document ---- */
function Doc() {
  this.body = new El('body');
  this.documentElement = new El('html');
}
Doc.prototype.createElement = function (t) { return new El(t); };
Doc.prototype.getElementById = function (id) {
  var found = null;
  walk(this.body, function (el) { if (!found && el.id === id) found = el; });
  return found;
};
Doc.prototype.querySelectorAll = function (sel) { return queryAll(this.body, sel); };
Doc.prototype.querySelector = function (sel) { return queryAll(this.body, sel)[0] || null; };
Doc.prototype.addEventListener = function () {};

module.exports = { El: El, Doc: Doc, matches: matches, queryAll: queryAll };
