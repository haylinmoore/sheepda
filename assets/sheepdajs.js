"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.name === "") {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.name === "") {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $dummyGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [], canBlock: false };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $goroutine.canBlock = true;
  $schedule($goroutine, direct);
};

var $scheduled = [], $schedulerActive = false;
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
    $schedulerActive = false;
  } finally {
    if ($schedulerActive) {
      setTimeout($runScheduled, 0);
    }
  }
};
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerActive) {
    $schedulerActive = true;
    setTimeout($runScheduled, 0);
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if (!$curGoroutine.canBlock) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var canBlock = $curGoroutine.canBlock;
      $curGoroutine.canBlock = false;
      try {
        var result = v.apply(passThis ? this : undefined, args);
      } finally {
        $curGoroutine.canBlock = canBlock;
      }
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, MakeFunc, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var $ptr, key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var $ptr, key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var $ptr, key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var $ptr, i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var $ptr, i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var $ptr, args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var $ptr, args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var $ptr, args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var $ptr, o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var $ptr, o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var $ptr, o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	MakeFunc = function(fn) {
		var $ptr, fn;
		return $makeFunc(fn);
	};
	$pkg.MakeFunc = MakeFunc;
	init = function() {
		var $ptr, e;
		e = new Error.ptr(null);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "", exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$3, init, GOROOT, Goexit, SetFinalizer;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType$3 = $ptrType(TypeAssertionError);
	init = function() {
		var $ptr, e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = (function(msg) {
			var $ptr, msg;
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
	};
	GOROOT = function() {
		var $ptr, goroot, process;
		process = $global.process;
		if (process === undefined) {
			return "/";
		}
		goroot = process.env.GOROOT;
		if (!(goroot === undefined)) {
			return $internalize(goroot, $String);
		}
		return "/usr/local/go";
	};
	$pkg.GOROOT = GOROOT;
	Goexit = function() {
		var $ptr;
		$curGoroutine.exit = $externalize(true, $Bool);
		$throw(null);
	};
	$pkg.Goexit = Goexit;
	SetFinalizer = function(x, f) {
		var $ptr, f, x;
	};
	$pkg.SetFinalizer = SetFinalizer;
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
		var $ptr;
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var $ptr, e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var $ptr, e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var $ptr, e;
		e = this.$val;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$3.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init("runtime", [{prop: "interfaceString", name: "interfaceString", exported: false, typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", exported: false, typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", exported: false, typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", true, "errors", false, function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var $ptr, text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init("errors", [{prop: "s", name: "s", exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release, ReleaseMerge, Disable, Enable, ReadRange, WriteRange;
	Acquire = function(addr) {
		var $ptr, addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var $ptr, addr;
	};
	$pkg.Release = Release;
	ReleaseMerge = function(addr) {
		var $ptr, addr;
	};
	$pkg.ReleaseMerge = ReleaseMerge;
	Disable = function() {
		var $ptr;
	};
	$pkg.Disable = Disable;
	Enable = function() {
		var $ptr;
	};
	$pkg.Enable = Enable;
	ReadRange = function(addr, len) {
		var $ptr, addr, len;
	};
	$pkg.ReadRange = ReadRange;
	WriteRange = function(addr, len) {
		var $ptr, addr, len;
	};
	$pkg.WriteRange = WriteRange;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadUint32, StoreUint32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var $ptr, addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var $ptr, addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadUint32 = function(addr) {
		var $ptr, addr;
		return addr.$get();
	};
	$pkg.LoadUint32 = LoadUint32;
	StoreUint32 = function(addr, val) {
		var $ptr, addr, val;
		addr.$set(val);
	};
	$pkg.StoreUint32 = StoreUint32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, race, runtime, atomic, Pool, Mutex, Locker, Once, poolLocal, notifyList, RWMutex, rlocker, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$3, ptrType$5, sliceType$3, ptrType$6, ptrType$7, funcType, ptrType$13, funcType$1, ptrType$14, arrayType$1, semWaiters, allPools, runtime_registerPoolCleanup, runtime_Semacquire, runtime_Semrelease, runtime_notifyListCheck, runtime_canSpin, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", true, "sync", true, function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$3.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", true, "sync", true, function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Locker = $pkg.Locker = $newType(8, $kindInterface, "sync.Locker", true, "sync", true, null);
	Once = $pkg.Once = $newType(0, $kindStruct, "sync.Once", true, "sync", true, function(m_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = new Mutex.ptr(0, 0);
			this.done = 0;
			return;
		}
		this.m = m_;
		this.done = done_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", true, "sync", false, function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$3.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			this.pad = arrayType$1.zero();
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
		this.pad = pad_;
	});
	notifyList = $pkg.notifyList = $newType(0, $kindStruct, "sync.notifyList", true, "sync", false, function(wait_, notify_, lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wait = 0;
			this.notify = 0;
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.wait = wait_;
		this.notify = notify_;
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	RWMutex = $pkg.RWMutex = $newType(0, $kindStruct, "sync.RWMutex", true, "sync", true, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	rlocker = $pkg.rlocker = $newType(0, $kindStruct, "sync.rlocker", true, "sync", false, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$3 = $ptrType($Int32);
	ptrType$5 = $ptrType(poolLocal);
	sliceType$3 = $sliceType($emptyInterface);
	ptrType$6 = $ptrType(rlocker);
	ptrType$7 = $ptrType(RWMutex);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$13 = $ptrType(Mutex);
	funcType$1 = $funcType([], [], false);
	ptrType$14 = $ptrType(Once);
	arrayType$1 = $arrayType($Uint8, 128);
	Pool.ptr.prototype.Get = function() {
		var $ptr, _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } */ case 4:
			$s = -1; return $ifaceNil;
			return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		$s = -1; return x$2;
		return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var $ptr, p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var $ptr, cleanup;
	};
	runtime_Semacquire = function(s) {
		var $ptr, _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s) {
		var $ptr, _entry, _key, ch, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; ch = $f.ch; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			$s = -1; return;
			return;
		}
		ch = (0 >= w.$length ? $throwRuntimeError("index out of range") : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_notifyListCheck = function(size) {
		var $ptr, size;
	};
	runtime_canSpin = function(i) {
		var $ptr, i;
		return false;
	};
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, awoke, iter, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; awoke = $f.awoke; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire(m);
			}
			$s = -1; return;
			return;
		}
		awoke = false;
		iter = 0;
		/* while (true) { */ case 1:
			old = m.state;
			new$1 = old | 1;
			/* */ if (!(((old & 1) === 0))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(((old & 1) === 0))) { */ case 3:
				if (runtime_canSpin(iter)) {
					if (!awoke && ((old & 2) === 0) && !(((old >> 2 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
						awoke = true;
					}
					runtime_doSpin();
					iter = iter + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
				new$1 = old + 4 >> 0;
			/* } */ case 4:
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 1) === 0) {
					/* break; */ $s = 2; continue;
				}
				$r = runtime_Semacquire((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				awoke = true;
				iter = 0;
			/* } */ case 6:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire(m);
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.awoke = awoke; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			race.Release(m);
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		/* while (true) { */ case 1:
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				$s = -1; return;
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 3:
				$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } */ case 4:
			old = m.state;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = this;
		if (atomic.LoadUint32((o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o)))) === 1) {
			$s = -1; return;
			return;
		}
		$r = o.m.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(o.m, "Unlock"), []]);
		/* */ if (o.done === 0) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (o.done === 0) { */ case 2:
			$deferred.push([atomic.StoreUint32, [(o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o))), 1]]);
			$r = f(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	poolCleanup = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < (p.localSize >> 0))) { break; }
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.shared, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.shared = sliceType$3.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		var $ptr;
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var $ptr, i, l, x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	init$1 = function() {
		var $ptr, n;
		n = new notifyList.ptr(0, 0, 0, 0, 0);
		runtime_notifyListCheck(20);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	RWMutex.ptr.prototype.RLock = function() {
		var $ptr, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		/* */ if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { */ case 1:
			$r = runtime_Semacquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RLock }; } $f.$ptr = $ptr; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RLock = function() { return this.$val.RLock(); };
	RWMutex.ptr.prototype.RUnlock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.ReleaseMerge((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1);
		/* */ if (r < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (r < 0) { */ case 1:
			if (((r + 1 >> 0) === 0) || ((r + 1 >> 0) === -1073741824)) {
				race.Enable();
				$panic(new $String("sync: RUnlock of unlocked RWMutex"));
			}
			/* */ if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { */ case 3:
				$r = runtime_Semrelease((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RUnlock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RUnlock = function() { return this.$val.RUnlock(); };
	RWMutex.ptr.prototype.Lock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		$r = rw.w.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1073741824) + 1073741824 >> 0;
		/* */ if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { */ case 2:
			$r = runtime_Semacquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Acquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Lock = function() { return this.$val.Lock(); };
	RWMutex.ptr.prototype.Unlock = function() {
		var $ptr, i, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; i = $f.i; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Release((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Release((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1073741824);
		if (r >= 1073741824) {
			race.Enable();
			$panic(new $String("sync: Unlock of unlocked RWMutex"));
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (r >> 0))) { break; } */ if(!(i < (r >> 0))) { $s = 2; continue; }
			$r = runtime_Semrelease((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$r = rw.w.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.i = i; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	RWMutex.ptr.prototype.RLocker = function() {
		var $ptr, rw;
		rw = this;
		return $pointerOfStructConversion(rw, ptrType$6);
	};
	RWMutex.prototype.RLocker = function() { return this.$val.RLocker(); };
	rlocker.ptr.prototype.Lock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$7).RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Lock = function() { return this.$val.Lock(); };
	rlocker.ptr.prototype.Unlock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$7).RUnlock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$5], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$5], false)}];
	ptrType$13.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$14.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$1], [], false)}];
	ptrType$7.methods = [{prop: "RLock", name: "RLock", pkg: "", typ: $funcType([], [], false)}, {prop: "RUnlock", name: "RUnlock", pkg: "", typ: $funcType([], [], false)}, {prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}, {prop: "RLocker", name: "RLocker", pkg: "", typ: $funcType([], [Locker], false)}];
	ptrType$6.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init("sync", [{prop: "local", name: "local", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", exported: false, typ: $Uintptr, tag: ""}, {prop: "store", name: "store", exported: false, typ: sliceType$3, tag: ""}, {prop: "New", name: "New", exported: true, typ: funcType, tag: ""}]);
	Mutex.init("sync", [{prop: "state", name: "state", exported: false, typ: $Int32, tag: ""}, {prop: "sema", name: "sema", exported: false, typ: $Uint32, tag: ""}]);
	Locker.init([{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}]);
	Once.init("sync", [{prop: "m", name: "m", exported: false, typ: Mutex, tag: ""}, {prop: "done", name: "done", exported: false, typ: $Uint32, tag: ""}]);
	poolLocal.init("sync", [{prop: "private$0", name: "private", exported: false, typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", exported: false, typ: sliceType$3, tag: ""}, {prop: "Mutex", name: "", exported: true, typ: Mutex, tag: ""}, {prop: "pad", name: "pad", exported: false, typ: arrayType$1, tag: ""}]);
	notifyList.init("sync", [{prop: "wait", name: "wait", exported: false, typ: $Uint32, tag: ""}, {prop: "notify", name: "notify", exported: false, typ: $Uint32, tag: ""}, {prop: "lock", name: "lock", exported: false, typ: $Uintptr, tag: ""}, {prop: "head", name: "head", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", exported: false, typ: $UnsafePointer, tag: ""}]);
	RWMutex.init("sync", [{prop: "w", name: "w", exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", exported: false, typ: $Int32, tag: ""}]);
	rlocker.init("sync", [{prop: "w", name: "w", exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", exported: false, typ: $Int32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = race.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, Reader, Writer, ReaderFrom, WriterTo, RuneScanner, sliceType, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	Reader = $pkg.Reader = $newType(8, $kindInterface, "io.Reader", true, "io", true, null);
	Writer = $pkg.Writer = $newType(8, $kindInterface, "io.Writer", true, "io", true, null);
	ReaderFrom = $pkg.ReaderFrom = $newType(8, $kindInterface, "io.ReaderFrom", true, "io", true, null);
	WriterTo = $pkg.WriterTo = $newType(8, $kindInterface, "io.WriterTo", true, "io", true, null);
	RuneScanner = $pkg.RuneScanner = $newType(8, $kindInterface, "io.RuneScanner", true, "io", true, null);
	sliceType = $sliceType($Uint8);
	Reader.init([{prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	Writer.init([{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	ReaderFrom.init([{prop: "ReadFrom", name: "ReadFrom", pkg: "", typ: $funcType([Reader], [$Int64, $error], false)}]);
	WriterTo.init([{prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([Writer], [$Int64, $error], false)}]);
	RuneScanner.init([{prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, RangeTable, Range16, Range32, sliceType, sliceType$1, _White_Space, IsSpace, is16, is32, isExcludingLatin;
	RangeTable = $pkg.RangeTable = $newType(0, $kindStruct, "unicode.RangeTable", true, "unicode", true, function(R16_, R32_, LatinOffset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.R16 = sliceType.nil;
			this.R32 = sliceType$1.nil;
			this.LatinOffset = 0;
			return;
		}
		this.R16 = R16_;
		this.R32 = R32_;
		this.LatinOffset = LatinOffset_;
	});
	Range16 = $pkg.Range16 = $newType(0, $kindStruct, "unicode.Range16", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	Range32 = $pkg.Range32 = $newType(0, $kindStruct, "unicode.Range32", true, "unicode", true, function(Lo_, Hi_, Stride_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Stride = 0;
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Stride = Stride_;
	});
	sliceType = $sliceType(Range16);
	sliceType$1 = $sliceType(Range32);
	IsSpace = function(r) {
		var $ptr, _1, r;
		if ((r >>> 0) <= 255) {
			_1 = r;
			if ((_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12)) || (_1 === (13)) || (_1 === (32)) || (_1 === (133)) || (_1 === (160))) {
				return true;
			}
			return false;
		}
		return isExcludingLatin($pkg.White_Space, r);
	};
	$pkg.IsSpace = IsSpace;
	is16 = function(ranges, r) {
		var $ptr, _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18 || r <= 255) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo << 16 >>> 16)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = ((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo << 16 >>> 16)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	is32 = function(ranges, r) {
		var $ptr, _i, _q, _r, _r$1, _ref, hi, i, lo, m, r, range_, range_$1, ranges;
		if (ranges.$length <= 18) {
			_ref = ranges;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo >>> 0)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = $clone(((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]), Range32);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo >>> 0)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	isExcludingLatin = function(rangeTab, r) {
		var $ptr, off, r, r16, r32, rangeTab, x;
		r16 = rangeTab.R16;
		off = rangeTab.LatinOffset;
		if (r16.$length > off && r <= ((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? $throwRuntimeError("index out of range") : r16.$array[r16.$offset + x])).Hi >> 0)) {
			return is16($subslice(r16, off), (r << 16 >>> 16));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= ((0 >= r32.$length ? $throwRuntimeError("index out of range") : r32.$array[r32.$offset + 0]).Lo >> 0)) {
			return is32(r32, (r >>> 0));
		}
		return false;
	};
	RangeTable.init("", [{prop: "R16", name: "R16", exported: true, typ: sliceType, tag: ""}, {prop: "R32", name: "R32", exported: true, typ: sliceType$1, tag: ""}, {prop: "LatinOffset", name: "LatinOffset", exported: true, typ: $Int, tag: ""}]);
	Range16.init("", [{prop: "Lo", name: "Lo", exported: true, typ: $Uint16, tag: ""}, {prop: "Hi", name: "Hi", exported: true, typ: $Uint16, tag: ""}, {prop: "Stride", name: "Stride", exported: true, typ: $Uint16, tag: ""}]);
	Range32.init("", [{prop: "Lo", name: "Lo", exported: true, typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", exported: true, typ: $Uint32, tag: ""}, {prop: "Stride", name: "Stride", exported: true, typ: $Uint32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_White_Space = new RangeTable.ptr(new sliceType([new Range16.ptr(9, 13, 1), new Range16.ptr(32, 32, 1), new Range16.ptr(133, 133, 1), new Range16.ptr(160, 160, 1), new Range16.ptr(5760, 5760, 1), new Range16.ptr(8192, 8202, 1), new Range16.ptr(8232, 8233, 1), new Range16.ptr(8239, 8239, 1), new Range16.ptr(8287, 8287, 1), new Range16.ptr(12288, 12288, 1)]), sliceType$1.nil, 4);
		$pkg.White_Space = _White_Space;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, FullRune, DecodeRune, DecodeRuneInString, DecodeLastRune, RuneLen, EncodeRune, RuneCount, RuneCountInString, RuneStart, ValidRune;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", true, "unicode/utf8", false, function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	FullRune = function(p) {
		var $ptr, accept, c, n, p, x, x$1, x$2;
		n = p.$length;
		if (n === 0) {
			return false;
		}
		x$1 = (x = (0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]), ((x < 0 || x >= first.length) ? $throwRuntimeError("index out of range") : first[x]));
		if (n >= (((x$1 & 7) >>> 0) >> 0)) {
			return true;
		}
		accept = $clone((x$2 = x$1 >>> 4 << 24 >>> 24, ((x$2 < 0 || x$2 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$2])), acceptRange);
		if (n > 1) {
			c = (1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1]);
			if (c < accept.lo || accept.hi < c) {
				return true;
			} else if (n > 2 && ((2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2]) < 128 || 191 < (2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2]))) {
				return true;
			}
		}
		return false;
	};
	$pkg.FullRune = FullRune;
	DecodeRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, b1, b2, b3, mask, n, p, p0, r, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = p.$length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		p0 = (0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]);
		x = ((p0 < 0 || p0 >= first.length) ? $throwRuntimeError("index out of range") : first[p0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = ((((0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		b1 = (1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1]);
		if (b1 < accept.lo || accept.hi < b1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((p0 & 31) >>> 0) >> 0) << 6 >> 0) | (((b1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		b2 = (2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2]);
		if (b2 < 128 || 191 < b2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((p0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		b3 = (3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3]);
		if (b3 < 128 || 191 < b3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((p0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((b2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRune = DecodeRune;
	DecodeRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? $throwRuntimeError("index out of range") : first[s0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((s.charCodeAt(0) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((s0 & 31) >>> 0) >> 0) << 6 >> 0) | (((s1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((s0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((s0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((s2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	DecodeLastRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, p, r, size, start;
		r = 0;
		size = 0;
		end = p.$length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = (((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]) >> 0);
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRune($subslice(p, start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRune = DecodeLastRune;
	RuneLen = function(r) {
		var $ptr, r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var $ptr, i, p, r;
		i = (r >>> 0);
		if (i <= 127) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24));
			return 1;
		} else if (i <= 2047) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	RuneCount = function(p) {
		var $ptr, accept, c, c$1, c$2, c$3, i, n, np, p, size, x, x$1, x$2, x$3, x$4;
		np = p.$length;
		n = 0;
		i = 0;
		while (true) {
			if (!(i < np)) { break; }
			n = n + (1) >> 0;
			c = ((i < 0 || i >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + i]);
			if (c < 128) {
				i = i + (1) >> 0;
				continue;
			}
			x = ((c < 0 || c >= first.length) ? $throwRuntimeError("index out of range") : first[c]);
			if (x === 241) {
				i = i + (1) >> 0;
				continue;
			}
			size = (((x & 7) >>> 0) >> 0);
			if ((i + size >> 0) > np) {
				i = i + (1) >> 0;
				continue;
			}
			accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
			c$1 = (x$2 = i + 1 >> 0, ((x$2 < 0 || x$2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$2]));
			if (c$1 < accept.lo || accept.hi < c$1) {
				size = 1;
			} else if (size === 2) {
			} else {
				c$2 = (x$3 = i + 2 >> 0, ((x$3 < 0 || x$3 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$3]));
				if (c$2 < 128 || 191 < c$2) {
					size = 1;
				} else if (size === 3) {
				} else {
					c$3 = (x$4 = i + 3 >> 0, ((x$4 < 0 || x$4 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$4]));
					if (c$3 < 128 || 191 < c$3) {
						size = 1;
					}
				}
			}
			i = i + (size) >> 0;
		}
		return n;
	};
	$pkg.RuneCount = RuneCount;
	RuneCountInString = function(s) {
		var $ptr, accept, c, c$1, c$2, c$3, i, n, ns, s, size, x, x$1;
		n = 0;
		ns = s.length;
		i = 0;
		while (true) {
			if (!(i < ns)) { break; }
			c = s.charCodeAt(i);
			if (c < 128) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			x = ((c < 0 || c >= first.length) ? $throwRuntimeError("index out of range") : first[c]);
			if (x === 241) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			size = (((x & 7) >>> 0) >> 0);
			if ((i + size >> 0) > ns) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
			c$1 = s.charCodeAt((i + 1 >> 0));
			if (c$1 < accept.lo || accept.hi < c$1) {
				size = 1;
			} else if (size === 2) {
			} else {
				c$2 = s.charCodeAt((i + 2 >> 0));
				if (c$2 < 128 || 191 < c$2) {
					size = 1;
				} else if (size === 3) {
				} else {
					c$3 = s.charCodeAt((i + 3 >> 0));
					if (c$3 < 128 || 191 < c$3) {
						size = 1;
					}
				}
			}
			i = i + (size) >> 0;
			n = n + (1) >> 0;
		}
		n = n;
		return n;
	};
	$pkg.RuneCountInString = RuneCountInString;
	RuneStart = function(b) {
		var $ptr, b;
		return !((((b & 192) >>> 0) === 128));
	};
	$pkg.RuneStart = RuneStart;
	ValidRune = function(r) {
		var $ptr, r;
		if (r < 0) {
			return false;
		} else if (55296 <= r && r <= 57343) {
			return false;
		} else if (r > 1114111) {
			return false;
		}
		return true;
	};
	$pkg.ValidRune = ValidRune;
	acceptRange.init("unicode/utf8", [{prop: "lo", name: "lo", exported: false, typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", exported: false, typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, io, unicode, utf8, Buffer, readOp, Reader, ptrType, sliceType, arrayType, arrayType$1, ptrType$1, IndexByte, makeSlice, NewReader;
	errors = $packages["errors"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Buffer = $pkg.Buffer = $newType(0, $kindStruct, "bytes.Buffer", true, "bytes", true, function(buf_, off_, runeBytes_, bootstrap_, lastRead_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType.nil;
			this.off = 0;
			this.runeBytes = arrayType.zero();
			this.bootstrap = arrayType$1.zero();
			this.lastRead = 0;
			return;
		}
		this.buf = buf_;
		this.off = off_;
		this.runeBytes = runeBytes_;
		this.bootstrap = bootstrap_;
		this.lastRead = lastRead_;
	});
	readOp = $pkg.readOp = $newType(4, $kindInt, "bytes.readOp", true, "bytes", false, null);
	Reader = $pkg.Reader = $newType(0, $kindStruct, "bytes.Reader", true, "bytes", true, function(s_, i_, prevRune_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = sliceType.nil;
			this.i = new $Int64(0, 0);
			this.prevRune = 0;
			return;
		}
		this.s = s_;
		this.i = i_;
		this.prevRune = prevRune_;
	});
	ptrType = $ptrType(Buffer);
	sliceType = $sliceType($Uint8);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	ptrType$1 = $ptrType(Reader);
	IndexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	$pkg.IndexByte = IndexByte;
	Buffer.ptr.prototype.Bytes = function() {
		var $ptr, b;
		b = this;
		return $subslice(b.buf, b.off);
	};
	Buffer.prototype.Bytes = function() { return this.$val.Bytes(); };
	Buffer.ptr.prototype.String = function() {
		var $ptr, b;
		b = this;
		if (b === ptrType.nil) {
			return "<nil>";
		}
		return $bytesToString($subslice(b.buf, b.off));
	};
	Buffer.prototype.String = function() { return this.$val.String(); };
	Buffer.ptr.prototype.Len = function() {
		var $ptr, b;
		b = this;
		return b.buf.$length - b.off >> 0;
	};
	Buffer.prototype.Len = function() { return this.$val.Len(); };
	Buffer.ptr.prototype.Cap = function() {
		var $ptr, b;
		b = this;
		return b.buf.$capacity;
	};
	Buffer.prototype.Cap = function() { return this.$val.Cap(); };
	Buffer.ptr.prototype.Truncate = function(n) {
		var $ptr, b, n;
		b = this;
		b.lastRead = 0;
		if (n < 0 || n > b.Len()) {
			$panic(new $String("bytes.Buffer: truncation out of range"));
		} else if ((n === 0)) {
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, (b.off + n >> 0));
	};
	Buffer.prototype.Truncate = function(n) { return this.$val.Truncate(n); };
	Buffer.ptr.prototype.Reset = function() {
		var $ptr, b;
		b = this;
		b.Truncate(0);
	};
	Buffer.prototype.Reset = function() { return this.$val.Reset(); };
	Buffer.ptr.prototype.grow = function(n) {
		var $ptr, _q, b, buf, m, n;
		b = this;
		m = b.Len();
		if ((m === 0) && !((b.off === 0))) {
			b.Truncate(0);
		}
		if ((b.buf.$length + n >> 0) > b.buf.$capacity) {
			buf = sliceType.nil;
			if (b.buf === sliceType.nil && n <= 64) {
				buf = $subslice(new sliceType(b.bootstrap), 0);
			} else if ((m + n >> 0) <= (_q = b.buf.$capacity / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))) {
				$copySlice(b.buf, $subslice(b.buf, b.off));
				buf = $subslice(b.buf, 0, m);
			} else {
				buf = makeSlice(($imul(2, b.buf.$capacity)) + n >> 0);
				$copySlice(buf, $subslice(b.buf, b.off));
			}
			b.buf = buf;
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, ((b.off + m >> 0) + n >> 0));
		return b.off + m >> 0;
	};
	Buffer.prototype.grow = function(n) { return this.$val.grow(n); };
	Buffer.ptr.prototype.Grow = function(n) {
		var $ptr, b, m, n;
		b = this;
		if (n < 0) {
			$panic(new $String("bytes.Buffer.Grow: negative count"));
		}
		m = b.grow(n);
		b.buf = $subslice(b.buf, 0, m);
	};
	Buffer.prototype.Grow = function(n) { return this.$val.Grow(n); };
	Buffer.ptr.prototype.Write = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(p.$length);
		_tmp = $copySlice($subslice(b.buf, m), p);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.Write = function(p) { return this.$val.Write(p); };
	Buffer.ptr.prototype.WriteString = function(s) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, s;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(s.length);
		_tmp = $copyString($subslice(b.buf, m), s);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	Buffer.ptr.prototype.ReadFrom = function(r) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, free, m, n, newBuf, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; free = $f.free; m = $f.m; n = $f.n; newBuf = $f.newBuf; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
		}
		/* while (true) { */ case 1:
			free = b.buf.$capacity - b.buf.$length >> 0;
			if (free < 512) {
				newBuf = b.buf;
				if ((b.off + free >> 0) < 512) {
					newBuf = makeSlice(($imul(2, b.buf.$capacity)) + 512 >> 0);
				}
				$copySlice(newBuf, $subslice(b.buf, b.off));
				b.buf = $subslice(newBuf, 0, (b.buf.$length - b.off >> 0));
				b.off = 0;
			}
			_r = r.Read($subslice(b.buf, b.buf.$length, b.buf.$capacity)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			b.buf = $subslice(b.buf, 0, (b.buf.$length + m >> 0));
			n = (x = new $Int64(0, m), new $Int64(n.$high + x.$high, n.$low + x.$low));
			if ($interfaceIsEqual(e, io.EOF)) {
				/* break; */ $s = 2; continue;
			}
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				$s = -1; return [n, err];
				return [n, err];
			}
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.ReadFrom }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.free = free; $f.m = m; $f.n = n; $f.newBuf = newBuf; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.ReadFrom = function(r) { return this.$val.ReadFrom(r); };
	makeSlice = function(n) {
		var $ptr, n, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			if (!($interfaceIsEqual($recover(), $ifaceNil))) {
				$panic($pkg.ErrTooLarge);
			}
		}), []]);
		return $makeSlice(sliceType, n);
		/* */ } catch(err) { $err = err; return sliceType.nil; } finally { $callDeferred($deferred, $err); }
	};
	Buffer.ptr.prototype.WriteTo = function(w) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, m, n, nBytes, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; m = $f.m; n = $f.n; nBytes = $f.nBytes; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		/* */ if (b.off < b.buf.$length) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (b.off < b.buf.$length) { */ case 1:
			nBytes = b.Len();
			_r = w.Write($subslice(b.buf, b.off)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			if (m > nBytes) {
				$panic(new $String("bytes.Buffer.WriteTo: invalid Write count"));
			}
			b.off = b.off + (m) >> 0;
			n = new $Int64(0, m);
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				$s = -1; return [n, err];
				return [n, err];
			}
			if (!((m === nBytes))) {
				_tmp$2 = n;
				_tmp$3 = io.ErrShortWrite;
				n = _tmp$2;
				err = _tmp$3;
				$s = -1; return [n, err];
				return [n, err];
			}
		/* } */ case 2:
		b.Truncate(0);
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.WriteTo }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.m = m; $f.n = n; $f.nBytes = nBytes; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.WriteTo = function(w) { return this.$val.WriteTo(w); };
	Buffer.ptr.prototype.WriteByte = function(c) {
		var $ptr, b, c, m, x;
		b = this;
		b.lastRead = 0;
		m = b.grow(1);
		(x = b.buf, ((m < 0 || m >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + m] = c));
		return $ifaceNil;
	};
	Buffer.prototype.WriteByte = function(c) { return this.$val.WriteByte(c); };
	Buffer.ptr.prototype.WriteRune = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, err, n, r;
		n = 0;
		err = $ifaceNil;
		b = this;
		if (r < 128) {
			b.WriteByte((r << 24 >>> 24));
			_tmp = 1;
			_tmp$1 = $ifaceNil;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = utf8.EncodeRune($subslice(new sliceType(b.runeBytes), 0), r);
		b.Write($subslice(new sliceType(b.runeBytes), 0, n));
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
	};
	Buffer.prototype.WriteRune = function(r) { return this.$val.WriteRune(r); };
	Buffer.ptr.prototype.Read = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			if (p.$length === 0) {
				return [n, err];
			}
			_tmp = 0;
			_tmp$1 = io.EOF;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = $copySlice(p, $subslice(b.buf, b.off));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return [n, err];
	};
	Buffer.prototype.Read = function(p) { return this.$val.Read(p); };
	Buffer.ptr.prototype.Next = function(n) {
		var $ptr, b, data, m, n;
		b = this;
		b.lastRead = 0;
		m = b.Len();
		if (n > m) {
			n = m;
		}
		data = $subslice(b.buf, b.off, (b.off + n >> 0));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return data;
	};
	Buffer.prototype.Next = function(n) { return this.$val.Next(n); };
	Buffer.ptr.prototype.ReadByte = function() {
		var $ptr, b, c, x, x$1;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			return [0, io.EOF];
		}
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		b.off = b.off + (1) >> 0;
		b.lastRead = 2;
		return [c, $ifaceNil];
	};
	Buffer.prototype.ReadByte = function() { return this.$val.ReadByte(); };
	Buffer.ptr.prototype.ReadRune = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tuple, b, c, err, n, r, size, x, x$1;
		r = 0;
		size = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			_tmp = 0;
			_tmp$1 = 0;
			_tmp$2 = io.EOF;
			r = _tmp;
			size = _tmp$1;
			err = _tmp$2;
			return [r, size, err];
		}
		b.lastRead = 1;
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (c < 128) {
			b.off = b.off + (1) >> 0;
			_tmp$3 = (c >> 0);
			_tmp$4 = 1;
			_tmp$5 = $ifaceNil;
			r = _tmp$3;
			size = _tmp$4;
			err = _tmp$5;
			return [r, size, err];
		}
		_tuple = utf8.DecodeRune($subslice(b.buf, b.off));
		r = _tuple[0];
		n = _tuple[1];
		b.off = b.off + (n) >> 0;
		_tmp$6 = r;
		_tmp$7 = n;
		_tmp$8 = $ifaceNil;
		r = _tmp$6;
		size = _tmp$7;
		err = _tmp$8;
		return [r, size, err];
	};
	Buffer.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	Buffer.ptr.prototype.UnreadRune = function() {
		var $ptr, _tuple, b, n;
		b = this;
		if (!((b.lastRead === 1))) {
			return errors.New("bytes.Buffer: UnreadRune: previous operation was not ReadRune");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			_tuple = utf8.DecodeLastRune($subslice(b.buf, 0, b.off));
			n = _tuple[1];
			b.off = b.off - (n) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	Buffer.ptr.prototype.UnreadByte = function() {
		var $ptr, b;
		b = this;
		if (!((b.lastRead === 1)) && !((b.lastRead === 2))) {
			return errors.New("bytes.Buffer: UnreadByte: previous operation was not a read");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			b.off = b.off - (1) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadByte = function() { return this.$val.UnreadByte(); };
	Buffer.ptr.prototype.ReadBytes = function(delim) {
		var $ptr, _tuple, b, delim, err, line, slice;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		line = $appendSlice(line, slice);
		return [line, err];
	};
	Buffer.prototype.ReadBytes = function(delim) { return this.$val.ReadBytes(delim); };
	Buffer.ptr.prototype.readSlice = function(delim) {
		var $ptr, _tmp, _tmp$1, b, delim, end, err, i, line;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		i = IndexByte($subslice(b.buf, b.off), delim);
		end = (b.off + i >> 0) + 1 >> 0;
		if (i < 0) {
			end = b.buf.$length;
			err = io.EOF;
		}
		line = $subslice(b.buf, b.off, end);
		b.off = end;
		b.lastRead = 2;
		_tmp = line;
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.readSlice = function(delim) { return this.$val.readSlice(delim); };
	Buffer.ptr.prototype.ReadString = function(delim) {
		var $ptr, _tmp, _tmp$1, _tuple, b, delim, err, line, slice;
		line = "";
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		_tmp = $bytesToString(slice);
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.ReadString = function(delim) { return this.$val.ReadString(delim); };
	Reader.ptr.prototype.Len = function() {
		var $ptr, r, x, x$1, x$2, x$3, x$4;
		r = this;
		if ((x = r.i, x$1 = new $Int64(0, r.s.$length), (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low >= x$1.$low)))) {
			return 0;
		}
		return ((x$2 = (x$3 = new $Int64(0, r.s.$length), x$4 = r.i, new $Int64(x$3.$high - x$4.$high, x$3.$low - x$4.$low)), x$2.$low + ((x$2.$high >> 31) * 4294967296)) >> 0);
	};
	Reader.prototype.Len = function() { return this.$val.Len(); };
	Reader.ptr.prototype.Size = function() {
		var $ptr, r;
		r = this;
		return new $Int64(0, r.s.$length);
	};
	Reader.prototype.Size = function() { return this.$val.Size(); };
	Reader.ptr.prototype.Read = function(b) {
		var $ptr, _tmp, _tmp$1, b, err, n, r, x, x$1, x$2, x$3;
		n = 0;
		err = $ifaceNil;
		r = this;
		if ((x = r.i, x$1 = new $Int64(0, r.s.$length), (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low >= x$1.$low)))) {
			_tmp = 0;
			_tmp$1 = io.EOF;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		r.prevRune = -1;
		n = $copySlice(b, $subslice(r.s, $flatten64(r.i)));
		r.i = (x$2 = r.i, x$3 = new $Int64(0, n), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low));
		return [n, err];
	};
	Reader.prototype.Read = function(b) { return this.$val.Read(b); };
	Reader.ptr.prototype.ReadAt = function(b, off) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, err, n, off, r, x;
		n = 0;
		err = $ifaceNil;
		r = this;
		if ((off.$high < 0 || (off.$high === 0 && off.$low < 0))) {
			_tmp = 0;
			_tmp$1 = errors.New("bytes.Reader.ReadAt: negative offset");
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		if ((x = new $Int64(0, r.s.$length), (off.$high > x.$high || (off.$high === x.$high && off.$low >= x.$low)))) {
			_tmp$2 = 0;
			_tmp$3 = io.EOF;
			n = _tmp$2;
			err = _tmp$3;
			return [n, err];
		}
		n = $copySlice(b, $subslice(r.s, $flatten64(off)));
		if (n < b.$length) {
			err = io.EOF;
		}
		return [n, err];
	};
	Reader.prototype.ReadAt = function(b, off) { return this.$val.ReadAt(b, off); };
	Reader.ptr.prototype.ReadByte = function() {
		var $ptr, b, r, x, x$1, x$2, x$3, x$4, x$5;
		r = this;
		r.prevRune = -1;
		if ((x = r.i, x$1 = new $Int64(0, r.s.$length), (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low >= x$1.$low)))) {
			return [0, io.EOF];
		}
		b = (x$2 = r.s, x$3 = r.i, (($flatten64(x$3) < 0 || $flatten64(x$3) >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + $flatten64(x$3)]));
		r.i = (x$4 = r.i, x$5 = new $Int64(0, 1), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
		return [b, $ifaceNil];
	};
	Reader.prototype.ReadByte = function() { return this.$val.ReadByte(); };
	Reader.ptr.prototype.UnreadByte = function() {
		var $ptr, r, x, x$1, x$2;
		r = this;
		r.prevRune = -1;
		if ((x = r.i, (x.$high < 0 || (x.$high === 0 && x.$low <= 0)))) {
			return errors.New("bytes.Reader.UnreadByte: at beginning of slice");
		}
		r.i = (x$1 = r.i, x$2 = new $Int64(0, 1), new $Int64(x$1.$high - x$2.$high, x$1.$low - x$2.$low));
		return $ifaceNil;
	};
	Reader.prototype.UnreadByte = function() { return this.$val.UnreadByte(); };
	Reader.ptr.prototype.ReadRune = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, c, ch, err, r, size, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8;
		ch = 0;
		size = 0;
		err = $ifaceNil;
		r = this;
		if ((x = r.i, x$1 = new $Int64(0, r.s.$length), (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low >= x$1.$low)))) {
			r.prevRune = -1;
			_tmp = 0;
			_tmp$1 = 0;
			_tmp$2 = io.EOF;
			ch = _tmp;
			size = _tmp$1;
			err = _tmp$2;
			return [ch, size, err];
		}
		r.prevRune = ((x$2 = r.i, x$2.$low + ((x$2.$high >> 31) * 4294967296)) >> 0);
		c = (x$3 = r.s, x$4 = r.i, (($flatten64(x$4) < 0 || $flatten64(x$4) >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + $flatten64(x$4)]));
		if (c < 128) {
			r.i = (x$5 = r.i, x$6 = new $Int64(0, 1), new $Int64(x$5.$high + x$6.$high, x$5.$low + x$6.$low));
			_tmp$3 = (c >> 0);
			_tmp$4 = 1;
			_tmp$5 = $ifaceNil;
			ch = _tmp$3;
			size = _tmp$4;
			err = _tmp$5;
			return [ch, size, err];
		}
		_tuple = utf8.DecodeRune($subslice(r.s, $flatten64(r.i)));
		ch = _tuple[0];
		size = _tuple[1];
		r.i = (x$7 = r.i, x$8 = new $Int64(0, size), new $Int64(x$7.$high + x$8.$high, x$7.$low + x$8.$low));
		return [ch, size, err];
	};
	Reader.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	Reader.ptr.prototype.UnreadRune = function() {
		var $ptr, r;
		r = this;
		if (r.prevRune < 0) {
			return errors.New("bytes.Reader.UnreadRune: previous operation was not ReadRune");
		}
		r.i = new $Int64(0, r.prevRune);
		r.prevRune = -1;
		return $ifaceNil;
	};
	Reader.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	Reader.ptr.prototype.Seek = function(offset, whence) {
		var $ptr, _1, abs, offset, r, whence, x, x$1;
		r = this;
		r.prevRune = -1;
		abs = new $Int64(0, 0);
		_1 = whence;
		if (_1 === (0)) {
			abs = offset;
		} else if (_1 === (1)) {
			abs = (x = r.i, new $Int64(x.$high + offset.$high, x.$low + offset.$low));
		} else if (_1 === (2)) {
			abs = (x$1 = new $Int64(0, r.s.$length), new $Int64(x$1.$high + offset.$high, x$1.$low + offset.$low));
		} else {
			return [new $Int64(0, 0), errors.New("bytes.Reader.Seek: invalid whence")];
		}
		if ((abs.$high < 0 || (abs.$high === 0 && abs.$low < 0))) {
			return [new $Int64(0, 0), errors.New("bytes.Reader.Seek: negative position")];
		}
		r.i = abs;
		return [abs, $ifaceNil];
	};
	Reader.prototype.Seek = function(offset, whence) { return this.$val.Seek(offset, whence); };
	Reader.ptr.prototype.WriteTo = function(w) {
		var $ptr, _r, _tmp, _tmp$1, _tuple, b, err, m, n, r, w, x, x$1, x$2, x$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; b = $f.b; err = $f.err; m = $f.m; n = $f.n; r = $f.r; w = $f.w; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		r = this;
		r.prevRune = -1;
		if ((x = r.i, x$1 = new $Int64(0, r.s.$length), (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low >= x$1.$low)))) {
			_tmp = new $Int64(0, 0);
			_tmp$1 = $ifaceNil;
			n = _tmp;
			err = _tmp$1;
			$s = -1; return [n, err];
			return [n, err];
		}
		b = $subslice(r.s, $flatten64(r.i));
		_r = w.Write(b); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		m = _tuple[0];
		err = _tuple[1];
		if (m > b.$length) {
			$panic(new $String("bytes.Reader.WriteTo: invalid Write count"));
		}
		r.i = (x$2 = r.i, x$3 = new $Int64(0, m), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low));
		n = new $Int64(0, m);
		if (!((m === b.$length)) && $interfaceIsEqual(err, $ifaceNil)) {
			err = io.ErrShortWrite;
		}
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.WriteTo }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.m = m; $f.n = n; $f.r = r; $f.w = w; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.WriteTo = function(w) { return this.$val.WriteTo(w); };
	Reader.ptr.prototype.Reset = function(b) {
		var $ptr, b, r;
		r = this;
		Reader.copy(r, new Reader.ptr(b, new $Int64(0, 0), -1));
	};
	Reader.prototype.Reset = function(b) { return this.$val.Reset(b); };
	NewReader = function(b) {
		var $ptr, b;
		return new Reader.ptr(b, new $Int64(0, 0), -1);
	};
	$pkg.NewReader = NewReader;
	ptrType.methods = [{prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "grow", name: "grow", pkg: "bytes", typ: $funcType([$Int], [$Int], false)}, {prop: "Grow", name: "Grow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}, {prop: "ReadFrom", name: "ReadFrom", pkg: "", typ: $funcType([io.Reader], [$Int64, $error], false)}, {prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([io.Writer], [$Int64, $error], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [$error], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [$Int, $error], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "Next", name: "Next", pkg: "", typ: $funcType([$Int], [sliceType], false)}, {prop: "ReadByte", name: "ReadByte", pkg: "", typ: $funcType([], [$Uint8, $error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "UnreadByte", name: "UnreadByte", pkg: "", typ: $funcType([], [$error], false)}, {prop: "ReadBytes", name: "ReadBytes", pkg: "", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "readSlice", name: "readSlice", pkg: "bytes", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "ReadString", name: "ReadString", pkg: "", typ: $funcType([$Uint8], [$String, $error], false)}];
	ptrType$1.methods = [{prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "ReadAt", name: "ReadAt", pkg: "", typ: $funcType([sliceType, $Int64], [$Int, $error], false)}, {prop: "ReadByte", name: "ReadByte", pkg: "", typ: $funcType([], [$Uint8, $error], false)}, {prop: "UnreadByte", name: "UnreadByte", pkg: "", typ: $funcType([], [$error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Seek", name: "Seek", pkg: "", typ: $funcType([$Int64, $Int], [$Int64, $error], false)}, {prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([io.Writer], [$Int64, $error], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([sliceType], [], false)}];
	Buffer.init("bytes", [{prop: "buf", name: "buf", exported: false, typ: sliceType, tag: ""}, {prop: "off", name: "off", exported: false, typ: $Int, tag: ""}, {prop: "runeBytes", name: "runeBytes", exported: false, typ: arrayType, tag: ""}, {prop: "bootstrap", name: "bootstrap", exported: false, typ: arrayType$1, tag: ""}, {prop: "lastRead", name: "lastRead", exported: false, typ: readOp, tag: ""}]);
	Reader.init("bytes", [{prop: "s", name: "s", exported: false, typ: sliceType, tag: ""}, {prop: "i", name: "i", exported: false, typ: $Int64, tag: ""}, {prop: "prevRune", name: "prevRune", exported: false, typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, arrayType$3, math, buf, pow10tab, init, Float32bits, Float64bits, init$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType("math", [{prop: "uint32array", name: "uint32array", exported: false, typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", exported: false, typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", exported: false, typ: arrayType$2, tag: ""}]);
	arrayType$3 = $arrayType($Float64, 70);
	init = function() {
		var $ptr, ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	Float32bits = function(f) {
		var $ptr, f;
		buf.float32array[0] = f;
		return buf.uint32array[0];
	};
	$pkg.Float32bits = Float32bits;
	Float64bits = function(f) {
		var $ptr, f, x, x$1;
		buf.float64array[0] = f;
		return (x = $shiftLeft64(new $Uint64(0, buf.uint32array[1]), 32), x$1 = new $Uint64(0, buf.uint32array[0]), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
	};
	$pkg.Float64bits = Float64bits;
	init$1 = function() {
		var $ptr, _q, i, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (true) {
			if (!(i < 70)) { break; }
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x])));
			i = i + (1) >> 0;
		}
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		pow10tab = arrayType$3.zero();
		math = $global.Math;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["syscall"] = (function() {
	var $pkg = {}, $init, js, race, runtime, sync, mmapper, Errno, Timespec, Stat_t, Dirent, sliceType, sliceType$1, ptrType$2, arrayType$5, arrayType$13, arrayType$14, structType, ptrType$22, ptrType$25, mapType, funcType, funcType$1, ptrType$29, arrayType$18, warningPrinted, lineBuffer, syscallModule, alreadyTriedToLoad, minusOne, envOnce, envLock, env, envs, mapper, errEAGAIN, errEINVAL, errENOENT, ioSync, ioSync$24ptr, errors, init, printWarning, printToConsole, use, indexByte, runtime_envs, syscall, Syscall, Syscall6, BytePtrFromString, copyenv, Getenv, msanRead, msanWrite, itoa, uitoa, clen, ReadDirent, ParseDirent, errnoErr, Read, Write, Close, Fchdir, Fchmod, Fsync, Getdents, read, write, munmap, Fchown, Fstat, Ftruncate, Lstat, Pread, Pwrite, Seek, mmap;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	mmapper = $pkg.mmapper = $newType(0, $kindStruct, "syscall.mmapper", true, "syscall", false, function(Mutex_, active_, mmap_, munmap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Mutex = new sync.Mutex.ptr(0, 0);
			this.active = false;
			this.mmap = $throwNilPointerError;
			this.munmap = $throwNilPointerError;
			return;
		}
		this.Mutex = Mutex_;
		this.active = active_;
		this.mmap = mmap_;
		this.munmap = munmap_;
	});
	Errno = $pkg.Errno = $newType(4, $kindUintptr, "syscall.Errno", true, "syscall", true, null);
	Timespec = $pkg.Timespec = $newType(0, $kindStruct, "syscall.Timespec", true, "syscall", true, function(Sec_, Nsec_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Sec = new $Int64(0, 0);
			this.Nsec = new $Int64(0, 0);
			return;
		}
		this.Sec = Sec_;
		this.Nsec = Nsec_;
	});
	Stat_t = $pkg.Stat_t = $newType(0, $kindStruct, "syscall.Stat_t", true, "syscall", true, function(Dev_, Ino_, Nlink_, Mode_, Uid_, Gid_, X__pad0_, Rdev_, Size_, Blksize_, Blocks_, Atim_, Mtim_, Ctim_, X__unused_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Dev = new $Uint64(0, 0);
			this.Ino = new $Uint64(0, 0);
			this.Nlink = new $Uint64(0, 0);
			this.Mode = 0;
			this.Uid = 0;
			this.Gid = 0;
			this.X__pad0 = 0;
			this.Rdev = new $Uint64(0, 0);
			this.Size = new $Int64(0, 0);
			this.Blksize = new $Int64(0, 0);
			this.Blocks = new $Int64(0, 0);
			this.Atim = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Mtim = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Ctim = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.X__unused = arrayType$18.zero();
			return;
		}
		this.Dev = Dev_;
		this.Ino = Ino_;
		this.Nlink = Nlink_;
		this.Mode = Mode_;
		this.Uid = Uid_;
		this.Gid = Gid_;
		this.X__pad0 = X__pad0_;
		this.Rdev = Rdev_;
		this.Size = Size_;
		this.Blksize = Blksize_;
		this.Blocks = Blocks_;
		this.Atim = Atim_;
		this.Mtim = Mtim_;
		this.Ctim = Ctim_;
		this.X__unused = X__unused_;
	});
	Dirent = $pkg.Dirent = $newType(0, $kindStruct, "syscall.Dirent", true, "syscall", true, function(Ino_, Off_, Reclen_, Type_, Name_, Pad_cgo_0_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Ino = new $Uint64(0, 0);
			this.Off = new $Int64(0, 0);
			this.Reclen = 0;
			this.Type = 0;
			this.Name = arrayType$13.zero();
			this.Pad_cgo_0 = arrayType$14.zero();
			return;
		}
		this.Ino = Ino_;
		this.Off = Off_;
		this.Reclen = Reclen_;
		this.Type = Type_;
		this.Name = Name_;
		this.Pad_cgo_0 = Pad_cgo_0_;
	});
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	ptrType$2 = $ptrType($Uint8);
	arrayType$5 = $arrayType($Uint8, 32);
	arrayType$13 = $arrayType($Int8, 256);
	arrayType$14 = $arrayType($Uint8, 5);
	structType = $structType("syscall", [{prop: "addr", name: "addr", exported: false, typ: $Uintptr, tag: ""}, {prop: "len", name: "len", exported: false, typ: $Int, tag: ""}, {prop: "cap", name: "cap", exported: false, typ: $Int, tag: ""}]);
	ptrType$22 = $ptrType($Int64);
	ptrType$25 = $ptrType(mmapper);
	mapType = $mapType(ptrType$2, sliceType);
	funcType = $funcType([$Uintptr, $Uintptr, $Int, $Int, $Int, $Int64], [$Uintptr, $error], false);
	funcType$1 = $funcType([$Uintptr, $Uintptr], [$error], false);
	ptrType$29 = $ptrType(Timespec);
	arrayType$18 = $arrayType($Int64, 3);
	init = function() {
		var $ptr;
		$flushConsole = (function() {
			var $ptr;
			if (!((lineBuffer.$length === 0))) {
				$global.console.log($externalize($bytesToString(lineBuffer), $String));
				lineBuffer = sliceType.nil;
			}
		});
	};
	printWarning = function() {
		var $ptr;
		if (!warningPrinted) {
			$global.console.error($externalize("warning: system calls not available, see https://github.com/gopherjs/gopherjs/blob/master/doc/syscalls.md", $String));
		}
		warningPrinted = true;
	};
	printToConsole = function(b) {
		var $ptr, b, goPrintToConsole, i;
		goPrintToConsole = $global.goPrintToConsole;
		if (!(goPrintToConsole === undefined)) {
			goPrintToConsole(b);
			return;
		}
		lineBuffer = $appendSlice(lineBuffer, b);
		while (true) {
			i = indexByte(lineBuffer, 10);
			if (i === -1) {
				break;
			}
			$global.console.log($externalize($bytesToString($subslice(lineBuffer, 0, i)), $String));
			lineBuffer = $subslice(lineBuffer, (i + 1 >> 0));
		}
	};
	use = function(p) {
		var $ptr, p;
	};
	indexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	runtime_envs = function() {
		var $ptr, envkeys, envs$1, i, jsEnv, key, process;
		process = $global.process;
		if (process === undefined) {
			return sliceType$1.nil;
		}
		jsEnv = process.env;
		envkeys = $global.Object.keys(jsEnv);
		envs$1 = $makeSlice(sliceType$1, $parseInt(envkeys.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(envkeys.length))) { break; }
			key = $internalize(envkeys[i], $String);
			((i < 0 || i >= envs$1.$length) ? $throwRuntimeError("index out of range") : envs$1.$array[envs$1.$offset + i] = key + "=" + $internalize(jsEnv[$externalize(key, $String)], $String));
			i = i + (1) >> 0;
		}
		return envs$1;
	};
	syscall = function(name) {
		var $ptr, name, require, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			$recover();
		}), []]);
		if (syscallModule === null) {
			if (alreadyTriedToLoad) {
				return null;
			}
			alreadyTriedToLoad = true;
			require = $global.require;
			if (require === undefined) {
				$panic(new $String(""));
			}
			syscallModule = require($externalize("syscall", $String));
		}
		return syscallModule[$externalize(name, $String)];
		/* */ } catch(err) { $err = err; return null; } finally { $callDeferred($deferred, $err); }
	};
	Syscall = function(trap, a1, a2, a3) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, a1, a2, a3, array, err, f, r, r1, r2, slice, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if ((trap === 1) && ((a1 === 1) || (a1 === 2))) {
			array = a2;
			slice = $makeSlice(sliceType, $parseInt(array.length));
			slice.$array = array;
			printToConsole(slice);
			_tmp$3 = ($parseInt(array.length) >>> 0);
			_tmp$4 = 0;
			_tmp$5 = 0;
			r1 = _tmp$3;
			r2 = _tmp$4;
			err = _tmp$5;
			return [r1, r2, err];
		}
		if (trap === 60) {
			runtime.Goexit();
		}
		printWarning();
		_tmp$6 = (minusOne >>> 0);
		_tmp$7 = 0;
		_tmp$8 = 13;
		r1 = _tmp$6;
		r2 = _tmp$7;
		err = _tmp$8;
		return [r1, r2, err];
	};
	$pkg.Syscall = Syscall;
	Syscall6 = function(trap, a1, a2, a3, a4, a5, a6) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, a1, a2, a3, a4, a5, a6, err, f, r, r1, r2, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall6");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3, a4, a5, a6);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if (!((trap === 202))) {
			printWarning();
		}
		_tmp$3 = (minusOne >>> 0);
		_tmp$4 = 0;
		_tmp$5 = 13;
		r1 = _tmp$3;
		r2 = _tmp$4;
		err = _tmp$5;
		return [r1, r2, err];
	};
	$pkg.Syscall6 = Syscall6;
	BytePtrFromString = function(s) {
		var $ptr, _i, _ref, array, b, i, s;
		array = new ($global.Uint8Array)(s.length + 1 >> 0);
		_ref = new sliceType($stringToBytes(s));
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === 0) {
				return [ptrType$2.nil, new Errno(22)];
			}
			array[i] = b;
			_i++;
		}
		array[s.length] = 0;
		return [array, $ifaceNil];
	};
	$pkg.BytePtrFromString = BytePtrFromString;
	copyenv = function() {
		var $ptr, _entry, _i, _key, _ref, _tuple, i, j, key, ok, s;
		env = {};
		_ref = envs;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			j = 0;
			while (true) {
				if (!(j < s.length)) { break; }
				if (s.charCodeAt(j) === 61) {
					key = $substring(s, 0, j);
					_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
					ok = _tuple[1];
					if (!ok) {
						_key = key; (env || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: i };
					} else {
						((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i] = "");
					}
					break;
				}
				j = j + (1) >> 0;
			}
			_i++;
		}
	};
	Getenv = function(key) {
		var $ptr, _entry, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, found, i, i$1, key, ok, s, value, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; found = $f.found; i = $f.i; i$1 = $f.i$1; key = $f.key; ok = $f.ok; s = $f.s; value = $f.value; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		value = "";
		found = false;
		$r = envOnce.Do(copyenv); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (key.length === 0) {
			_tmp = "";
			_tmp$1 = false;
			value = _tmp;
			found = _tmp$1;
			$s = -1; return [value, found];
			return [value, found];
		}
		$r = envLock.RLock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(envLock, "RUnlock"), []]);
		_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
		i = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			_tmp$2 = "";
			_tmp$3 = false;
			value = _tmp$2;
			found = _tmp$3;
			$s = -1; return [value, found];
			return [value, found];
		}
		s = ((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i]);
		i$1 = 0;
		while (true) {
			if (!(i$1 < s.length)) { break; }
			if (s.charCodeAt(i$1) === 61) {
				_tmp$4 = $substring(s, (i$1 + 1 >> 0));
				_tmp$5 = true;
				value = _tmp$4;
				found = _tmp$5;
				$s = -1; return [value, found];
				return [value, found];
			}
			i$1 = i$1 + (1) >> 0;
		}
		_tmp$6 = "";
		_tmp$7 = false;
		value = _tmp$6;
		found = _tmp$7;
		$s = -1; return [value, found];
		return [value, found];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [value, found]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Getenv }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f.found = found; $f.i = i; $f.i$1 = i$1; $f.key = key; $f.ok = ok; $f.s = s; $f.value = value; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.Getenv = Getenv;
	msanRead = function(addr, len) {
		var $ptr, addr, len;
	};
	msanWrite = function(addr, len) {
		var $ptr, addr, len;
	};
	itoa = function(val) {
		var $ptr, val;
		if (val < 0) {
			return "-" + uitoa((-val >>> 0));
		}
		return uitoa((val >>> 0));
	};
	uitoa = function(val) {
		var $ptr, _q, _r, buf, i, val;
		buf = arrayType$5.zero();
		i = 31;
		while (true) {
			if (!(val >= 10)) { break; }
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((_r = val % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			i = i - (1) >> 0;
			val = (_q = val / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((val + 48 >>> 0) << 24 >>> 24));
		return $bytesToString($subslice(new sliceType(buf), i));
	};
	Timespec.ptr.prototype.Unix = function() {
		var $ptr, _tmp, _tmp$1, nsec, sec, ts;
		sec = new $Int64(0, 0);
		nsec = new $Int64(0, 0);
		ts = this;
		_tmp = ts.Sec;
		_tmp$1 = ts.Nsec;
		sec = _tmp;
		nsec = _tmp$1;
		return [sec, nsec];
	};
	Timespec.prototype.Unix = function() { return this.$val.Unix(); };
	Timespec.ptr.prototype.Nano = function() {
		var $ptr, ts, x, x$1;
		ts = this;
		return (x = $mul64(ts.Sec, new $Int64(0, 1000000000)), x$1 = ts.Nsec, new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
	};
	Timespec.prototype.Nano = function() { return this.$val.Nano(); };
	clen = function(n) {
		var $ptr, i, n;
		i = 0;
		while (true) {
			if (!(i < n.$length)) { break; }
			if (((i < 0 || i >= n.$length) ? $throwRuntimeError("index out of range") : n.$array[n.$offset + i]) === 0) {
				return i;
			}
			i = i + (1) >> 0;
		}
		return n.$length;
	};
	ReadDirent = function(fd, buf) {
		var $ptr, _tuple, buf, err, fd, n;
		n = 0;
		err = $ifaceNil;
		_tuple = Getdents(fd, buf);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	$pkg.ReadDirent = ReadDirent;
	ParseDirent = function(buf, max, names) {
		var $ptr, _array, _struct, _tmp, _tmp$1, _tmp$2, _view, buf, bytes, consumed, count, dirent, max, name, names, newnames, origlen, x;
		consumed = 0;
		count = 0;
		newnames = sliceType$1.nil;
		origlen = buf.$length;
		count = 0;
		while (true) {
			if (!(!((max === 0)) && buf.$length > 0)) { break; }
			dirent = (_array = $sliceToArray(buf), _struct = new Dirent.ptr(new $Uint64(0, 0), new $Int64(0, 0), 0, 0, arrayType$13.zero(), arrayType$14.zero()), _view = new DataView(_array.buffer, _array.byteOffset), _struct.Ino = new $Uint64(_view.getUint32(4, true), _view.getUint32(0, true)), _struct.Off = new $Int64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Reclen = _view.getUint16(16, true), _struct.Type = _view.getUint8(18, true), _struct.Name = new ($nativeArray($kindInt8))(_array.buffer, $min(_array.byteOffset + 19, _array.buffer.byteLength)), _struct.Pad_cgo_0 = new ($nativeArray($kindUint8))(_array.buffer, $min(_array.byteOffset + 275, _array.buffer.byteLength)), _struct);
			buf = $subslice(buf, dirent.Reclen);
			if ((x = dirent.Ino, (x.$high === 0 && x.$low === 0))) {
				continue;
			}
			bytes = $sliceToArray(new sliceType(dirent.Name));
			name = $bytesToString($subslice(new sliceType(bytes), 0, clen(new sliceType(bytes))));
			if (name === "." || name === "..") {
				continue;
			}
			max = max - (1) >> 0;
			count = count + (1) >> 0;
			names = $append(names, name);
		}
		_tmp = origlen - buf.$length >> 0;
		_tmp$1 = count;
		_tmp$2 = names;
		consumed = _tmp;
		count = _tmp$1;
		newnames = _tmp$2;
		return [consumed, count, newnames];
	};
	$pkg.ParseDirent = ParseDirent;
	mmapper.ptr.prototype.Mmap = function(fd, offset, length, prot, flags) {
		var $ptr, _key, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, addr, b, data, err, errno, fd, flags, length, m, offset, p, prot, sl, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; addr = $f.addr; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; fd = $f.fd; flags = $f.flags; length = $f.length; m = $f.m; offset = $f.offset; p = $f.p; prot = $f.prot; sl = $f.sl; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		sl = [sl];
		data = sliceType.nil;
		err = $ifaceNil;
		m = this;
		if (length <= 0) {
			_tmp = sliceType.nil;
			_tmp$1 = new Errno(22);
			data = _tmp;
			err = _tmp$1;
			$s = -1; return [data, err];
			return [data, err];
		}
		_r = m.mmap(0, (length >>> 0), prot, flags, fd, offset); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		addr = _tuple[0];
		errno = _tuple[1];
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = errno;
			data = _tmp$2;
			err = _tmp$3;
			$s = -1; return [data, err];
			return [data, err];
		}
		sl[0] = new structType.ptr(addr, length, length);
		b = sl[0];
		p = $indexPtr(b.$array, b.$offset + (b.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		_key = p; (m.active || $throwRuntimeError("assignment to entry in nil map"))[ptrType$2.keyFor(_key)] = { k: _key, v: b };
		_tmp$4 = b;
		_tmp$5 = $ifaceNil;
		data = _tmp$4;
		err = _tmp$5;
		$s = -1; return [data, err];
		return [data, err];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Mmap }; } $f.$ptr = $ptr; $f._key = _key; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.addr = addr; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.fd = fd; $f.flags = flags; $f.length = length; $f.m = m; $f.offset = offset; $f.p = p; $f.prot = prot; $f.sl = sl; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Mmap = function(fd, offset, length, prot, flags) { return this.$val.Mmap(fd, offset, length, prot, flags); };
	mmapper.ptr.prototype.Munmap = function(data) {
		var $ptr, _entry, _r, b, data, err, errno, m, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; m = $f.m; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		m = this;
		if ((data.$length === 0) || !((data.$length === data.$capacity))) {
			err = new Errno(22);
			$s = -1; return err;
			return err;
		}
		p = $indexPtr(data.$array, data.$offset + (data.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		b = (_entry = m.active[ptrType$2.keyFor(p)], _entry !== undefined ? _entry.v : sliceType.nil);
		if (b === sliceType.nil || !($indexPtr(b.$array, b.$offset + 0, ptrType$2) === $indexPtr(data.$array, data.$offset + 0, ptrType$2))) {
			err = new Errno(22);
			$s = -1; return err;
			return err;
		}
		_r = m.munmap($sliceToArray(b), (b.$length >>> 0)); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		errno = _r;
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			err = errno;
			$s = -1; return err;
			return err;
		}
		delete m.active[ptrType$2.keyFor(p)];
		err = $ifaceNil;
		$s = -1; return err;
		return err;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Munmap }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.m = m; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Munmap = function(data) { return this.$val.Munmap(data); };
	Errno.prototype.Error = function() {
		var $ptr, e, s;
		e = this.$val;
		if (0 <= (e >> 0) && (e >> 0) < 133) {
			s = ((e < 0 || e >= errors.length) ? $throwRuntimeError("index out of range") : errors[e]);
			if (!(s === "")) {
				return s;
			}
		}
		return "errno " + itoa((e >> 0));
	};
	$ptrType(Errno).prototype.Error = function() { return new Errno(this.$get()).Error(); };
	Errno.prototype.Temporary = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 4) || (e === 24) || (e === 104) || (e === 103) || new Errno(e).Timeout();
	};
	$ptrType(Errno).prototype.Temporary = function() { return new Errno(this.$get()).Temporary(); };
	Errno.prototype.Timeout = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 11) || (e === 11) || (e === 110);
	};
	$ptrType(Errno).prototype.Timeout = function() { return new Errno(this.$get()).Timeout(); };
	errnoErr = function(e) {
		var $ptr, _1, e;
		_1 = e;
		if (_1 === (0)) {
			return $ifaceNil;
		} else if (_1 === (11)) {
			return errEAGAIN;
		} else if (_1 === (22)) {
			return errEINVAL;
		} else if (_1 === (2)) {
			return errENOENT;
		}
		return new Errno(e);
	};
	Read = function(fd, p) {
		var $ptr, _tuple, err, fd, n, p;
		n = 0;
		err = $ifaceNil;
		_tuple = read(fd, p);
		n = _tuple[0];
		err = _tuple[1];
		if (false) {
			if (n > 0) {
				race.WriteRange($sliceToArray(p), n);
			}
			if ($interfaceIsEqual(err, $ifaceNil)) {
				race.Acquire((ioSync$24ptr || (ioSync$24ptr = new ptrType$22(function() { return ioSync; }, function($v) { ioSync = $v; }))));
			}
		}
		if (false && n > 0) {
			msanWrite($sliceToArray(p), n);
		}
		return [n, err];
	};
	$pkg.Read = Read;
	Write = function(fd, p) {
		var $ptr, _tuple, err, fd, n, p;
		n = 0;
		err = $ifaceNil;
		if (false) {
			race.ReleaseMerge((ioSync$24ptr || (ioSync$24ptr = new ptrType$22(function() { return ioSync; }, function($v) { ioSync = $v; }))));
		}
		_tuple = write(fd, p);
		n = _tuple[0];
		err = _tuple[1];
		if (false && n > 0) {
			race.ReadRange($sliceToArray(p), n);
		}
		if (false && n > 0) {
			msanRead($sliceToArray(p), n);
		}
		return [n, err];
	};
	$pkg.Write = Write;
	Close = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(3, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Close = Close;
	Fchdir = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(81, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchdir = Fchdir;
	Fchmod = function(fd, mode) {
		var $ptr, _tuple, e1, err, fd, mode;
		err = $ifaceNil;
		_tuple = Syscall(91, (fd >>> 0), (mode >>> 0), 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchmod = Fchmod;
	Fsync = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(74, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fsync = Fsync;
	Getdents = function(fd, buf) {
		var $ptr, _p0, _tuple, buf, e1, err, fd, n, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (buf.$length > 0) {
			_p0 = $sliceToArray(buf);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall(217, (fd >>> 0), _p0, (buf.$length >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Getdents = Getdents;
	read = function(fd, p) {
		var $ptr, _p0, _tuple, e1, err, fd, n, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall(0, (fd >>> 0), _p0, (p.$length >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	write = function(fd, p) {
		var $ptr, _p0, _tuple, e1, err, fd, n, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall(1, (fd >>> 0), _p0, (p.$length >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	munmap = function(addr, length) {
		var $ptr, _tuple, addr, e1, err, length;
		err = $ifaceNil;
		_tuple = Syscall(11, addr, length, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	Fchown = function(fd, uid, gid) {
		var $ptr, _tuple, e1, err, fd, gid, uid;
		err = $ifaceNil;
		_tuple = Syscall(93, (fd >>> 0), (uid >>> 0), (gid >>> 0));
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchown = Fchown;
	Fstat = function(fd, stat) {
		var $ptr, _array, _struct, _tuple, _view, e1, err, fd, stat;
		err = $ifaceNil;
		_array = new Uint8Array(144);
		_tuple = Syscall(5, (fd >>> 0), _array, 0);
		_struct = stat, _view = new DataView(_array.buffer, _array.byteOffset), _struct.Dev = new $Uint64(_view.getUint32(4, true), _view.getUint32(0, true)), _struct.Ino = new $Uint64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Nlink = new $Uint64(_view.getUint32(20, true), _view.getUint32(16, true)), _struct.Mode = _view.getUint32(24, true), _struct.Uid = _view.getUint32(28, true), _struct.Gid = _view.getUint32(32, true), _struct.X__pad0 = _view.getInt32(36, true), _struct.Rdev = new $Uint64(_view.getUint32(44, true), _view.getUint32(40, true)), _struct.Size = new $Int64(_view.getUint32(52, true), _view.getUint32(48, true)), _struct.Blksize = new $Int64(_view.getUint32(60, true), _view.getUint32(56, true)), _struct.Blocks = new $Int64(_view.getUint32(68, true), _view.getUint32(64, true)), _struct.Atim.Sec = new $Int64(_view.getUint32(76, true), _view.getUint32(72, true)), _struct.Atim.Nsec = new $Int64(_view.getUint32(84, true), _view.getUint32(80, true)), _struct.Mtim.Sec = new $Int64(_view.getUint32(92, true), _view.getUint32(88, true)), _struct.Mtim.Nsec = new $Int64(_view.getUint32(100, true), _view.getUint32(96, true)), _struct.Ctim.Sec = new $Int64(_view.getUint32(108, true), _view.getUint32(104, true)), _struct.Ctim.Nsec = new $Int64(_view.getUint32(116, true), _view.getUint32(112, true)), _struct.X__unused = new ($nativeArray($kindInt64))(_array.buffer, $min(_array.byteOffset + 120, _array.buffer.byteLength));
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fstat = Fstat;
	Ftruncate = function(fd, length) {
		var $ptr, _tuple, e1, err, fd, length;
		err = $ifaceNil;
		_tuple = Syscall(77, (fd >>> 0), (length.$low >>> 0), 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Ftruncate = Ftruncate;
	Lstat = function(path, stat) {
		var $ptr, _array, _p0, _struct, _tuple, _tuple$1, _view, e1, err, path, stat;
		err = $ifaceNil;
		_p0 = ptrType$2.nil;
		_tuple = BytePtrFromString(path);
		_p0 = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		_array = new Uint8Array(144);
		_tuple$1 = Syscall(6, _p0, _array, 0);
		_struct = stat, _view = new DataView(_array.buffer, _array.byteOffset), _struct.Dev = new $Uint64(_view.getUint32(4, true), _view.getUint32(0, true)), _struct.Ino = new $Uint64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Nlink = new $Uint64(_view.getUint32(20, true), _view.getUint32(16, true)), _struct.Mode = _view.getUint32(24, true), _struct.Uid = _view.getUint32(28, true), _struct.Gid = _view.getUint32(32, true), _struct.X__pad0 = _view.getInt32(36, true), _struct.Rdev = new $Uint64(_view.getUint32(44, true), _view.getUint32(40, true)), _struct.Size = new $Int64(_view.getUint32(52, true), _view.getUint32(48, true)), _struct.Blksize = new $Int64(_view.getUint32(60, true), _view.getUint32(56, true)), _struct.Blocks = new $Int64(_view.getUint32(68, true), _view.getUint32(64, true)), _struct.Atim.Sec = new $Int64(_view.getUint32(76, true), _view.getUint32(72, true)), _struct.Atim.Nsec = new $Int64(_view.getUint32(84, true), _view.getUint32(80, true)), _struct.Mtim.Sec = new $Int64(_view.getUint32(92, true), _view.getUint32(88, true)), _struct.Mtim.Nsec = new $Int64(_view.getUint32(100, true), _view.getUint32(96, true)), _struct.Ctim.Sec = new $Int64(_view.getUint32(108, true), _view.getUint32(104, true)), _struct.Ctim.Nsec = new $Int64(_view.getUint32(116, true), _view.getUint32(112, true)), _struct.X__unused = new ($nativeArray($kindInt64))(_array.buffer, $min(_array.byteOffset + 120, _array.buffer.byteLength));
		e1 = _tuple$1[2];
		use(_p0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Lstat = Lstat;
	Pread = function(fd, p, offset) {
		var $ptr, _p0, _tuple, e1, err, fd, n, offset, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(17, (fd >>> 0), _p0, (p.$length >>> 0), (offset.$low >>> 0), 0, 0);
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Pread = Pread;
	Pwrite = function(fd, p, offset) {
		var $ptr, _p0, _tuple, e1, err, fd, n, offset, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(18, (fd >>> 0), _p0, (p.$length >>> 0), (offset.$low >>> 0), 0, 0);
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Pwrite = Pwrite;
	Seek = function(fd, offset, whence) {
		var $ptr, _tuple, e1, err, fd, off, offset, r0, whence;
		off = new $Int64(0, 0);
		err = $ifaceNil;
		_tuple = Syscall(8, (fd >>> 0), (offset.$low >>> 0), (whence >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		off = new $Int64(0, r0.constructor === Number ? r0 : 1);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [off, err];
	};
	$pkg.Seek = Seek;
	mmap = function(addr, length, prot, flags, fd, offset) {
		var $ptr, _tuple, addr, e1, err, fd, flags, length, offset, prot, r0, xaddr;
		xaddr = 0;
		err = $ifaceNil;
		_tuple = Syscall6(9, addr, length, (prot >>> 0), (flags >>> 0), (fd >>> 0), (offset.$low >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		xaddr = r0;
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [xaddr, err];
	};
	ptrType$25.methods = [{prop: "Mmap", name: "Mmap", pkg: "", typ: $funcType([$Int, $Int64, $Int, $Int, $Int], [sliceType, $error], false)}, {prop: "Munmap", name: "Munmap", pkg: "", typ: $funcType([sliceType], [$error], false)}];
	Errno.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Temporary", name: "Temporary", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $funcType([], [$Bool], false)}];
	ptrType$29.methods = [{prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64, $Int64], false)}, {prop: "Nano", name: "Nano", pkg: "", typ: $funcType([], [$Int64], false)}];
	mmapper.init("syscall", [{prop: "Mutex", name: "", exported: true, typ: sync.Mutex, tag: ""}, {prop: "active", name: "active", exported: false, typ: mapType, tag: ""}, {prop: "mmap", name: "mmap", exported: false, typ: funcType, tag: ""}, {prop: "munmap", name: "munmap", exported: false, typ: funcType$1, tag: ""}]);
	Timespec.init("", [{prop: "Sec", name: "Sec", exported: true, typ: $Int64, tag: ""}, {prop: "Nsec", name: "Nsec", exported: true, typ: $Int64, tag: ""}]);
	Stat_t.init("", [{prop: "Dev", name: "Dev", exported: true, typ: $Uint64, tag: ""}, {prop: "Ino", name: "Ino", exported: true, typ: $Uint64, tag: ""}, {prop: "Nlink", name: "Nlink", exported: true, typ: $Uint64, tag: ""}, {prop: "Mode", name: "Mode", exported: true, typ: $Uint32, tag: ""}, {prop: "Uid", name: "Uid", exported: true, typ: $Uint32, tag: ""}, {prop: "Gid", name: "Gid", exported: true, typ: $Uint32, tag: ""}, {prop: "X__pad0", name: "X__pad0", exported: true, typ: $Int32, tag: ""}, {prop: "Rdev", name: "Rdev", exported: true, typ: $Uint64, tag: ""}, {prop: "Size", name: "Size", exported: true, typ: $Int64, tag: ""}, {prop: "Blksize", name: "Blksize", exported: true, typ: $Int64, tag: ""}, {prop: "Blocks", name: "Blocks", exported: true, typ: $Int64, tag: ""}, {prop: "Atim", name: "Atim", exported: true, typ: Timespec, tag: ""}, {prop: "Mtim", name: "Mtim", exported: true, typ: Timespec, tag: ""}, {prop: "Ctim", name: "Ctim", exported: true, typ: Timespec, tag: ""}, {prop: "X__unused", name: "X__unused", exported: true, typ: arrayType$18, tag: ""}]);
	Dirent.init("", [{prop: "Ino", name: "Ino", exported: true, typ: $Uint64, tag: ""}, {prop: "Off", name: "Off", exported: true, typ: $Int64, tag: ""}, {prop: "Reclen", name: "Reclen", exported: true, typ: $Uint16, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: $Uint8, tag: ""}, {prop: "Name", name: "Name", exported: true, typ: arrayType$13, tag: ""}, {prop: "Pad_cgo_0", name: "Pad_cgo_0", exported: true, typ: arrayType$14, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		lineBuffer = sliceType.nil;
		syscallModule = null;
		envOnce = new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0);
		envLock = new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0);
		env = false;
		ioSync = new $Int64(0, 0);
		warningPrinted = false;
		alreadyTriedToLoad = false;
		minusOne = -1;
		envs = runtime_envs();
		$pkg.Stdin = 0;
		$pkg.Stdout = 1;
		$pkg.Stderr = 2;
		errEAGAIN = new Errno(11);
		errEINVAL = new Errno(22);
		errENOENT = new Errno(2);
		errors = $toNativeArray($kindString, ["", "operation not permitted", "no such file or directory", "no such process", "interrupted system call", "input/output error", "no such device or address", "argument list too long", "exec format error", "bad file descriptor", "no child processes", "resource temporarily unavailable", "cannot allocate memory", "permission denied", "bad address", "block device required", "device or resource busy", "file exists", "invalid cross-device link", "no such device", "not a directory", "is a directory", "invalid argument", "too many open files in system", "too many open files", "inappropriate ioctl for device", "text file busy", "file too large", "no space left on device", "illegal seek", "read-only file system", "too many links", "broken pipe", "numerical argument out of domain", "numerical result out of range", "resource deadlock avoided", "file name too long", "no locks available", "function not implemented", "directory not empty", "too many levels of symbolic links", "", "no message of desired type", "identifier removed", "channel number out of range", "level 2 not synchronized", "level 3 halted", "level 3 reset", "link number out of range", "protocol driver not attached", "no CSI structure available", "level 2 halted", "invalid exchange", "invalid request descriptor", "exchange full", "no anode", "invalid request code", "invalid slot", "", "bad font file format", "device not a stream", "no data available", "timer expired", "out of streams resources", "machine is not on the network", "package not installed", "object is remote", "link has been severed", "advertise error", "srmount error", "communication error on send", "protocol error", "multihop attempted", "RFS specific error", "bad message", "value too large for defined data type", "name not unique on network", "file descriptor in bad state", "remote address changed", "can not access a needed shared library", "accessing a corrupted shared library", ".lib section in a.out corrupted", "attempting to link in too many shared libraries", "cannot exec a shared library directly", "invalid or incomplete multibyte or wide character", "interrupted system call should be restarted", "streams pipe error", "too many users", "socket operation on non-socket", "destination address required", "message too long", "protocol wrong type for socket", "protocol not available", "protocol not supported", "socket type not supported", "operation not supported", "protocol family not supported", "address family not supported by protocol", "address already in use", "cannot assign requested address", "network is down", "network is unreachable", "network dropped connection on reset", "software caused connection abort", "connection reset by peer", "no buffer space available", "transport endpoint is already connected", "transport endpoint is not connected", "cannot send after transport endpoint shutdown", "too many references: cannot splice", "connection timed out", "connection refused", "host is down", "no route to host", "operation already in progress", "operation now in progress", "stale NFS file handle", "structure needs cleaning", "not a XENIX named type file", "no XENIX semaphores available", "is a named type file", "remote I/O error", "disk quota exceeded", "no medium found", "wrong medium type", "operation canceled", "required key not available", "key has expired", "key has been revoked", "key was rejected by service", "owner died", "state not recoverable", "operation not possible due to RF-kill"]);
		mapper = new mmapper.ptr(new sync.Mutex.ptr(0, 0), {}, mmap, munmap);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Once, funcType, ptrType$3;
	Once = $pkg.Once = $newType(0, $kindStruct, "nosync.Once", true, "github.com/gopherjs/gopherjs/nosync", true, function(doing_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.doing = false;
			this.done = false;
			return;
		}
		this.doing = doing_;
		this.done = done_;
	});
	funcType = $funcType([], [], false);
	ptrType$3 = $ptrType(Once);
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = [o];
		o[0] = this;
		if (o[0].done) {
			$s = -1; return;
			return;
		}
		if (o[0].doing) {
			$panic(new $String("nosync: Do called within f"));
		}
		o[0].doing = true;
		$deferred.push([(function(o) { return function() {
			var $ptr;
			o[0].doing = false;
			o[0].done = true;
		}; })(o), []]);
		$r = f(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	ptrType$3.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType], [], false)}];
	Once.init("github.com/gopherjs/gopherjs/nosync", [{prop: "doing", name: "doing", exported: false, typ: $Bool, tag: ""}, {prop: "done", name: "done", exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["time"] = (function() {
	var $pkg = {}, $init, errors, js, nosync, runtime, syscall, ParseError, Time, Month, Weekday, Duration, Location, zone, zoneTrans, sliceType, sliceType$1, ptrType, sliceType$2, arrayType, sliceType$3, arrayType$1, arrayType$2, ptrType$1, arrayType$4, ptrType$3, ptrType$6, std0x, longDayNames, shortDayNames, shortMonthNames, longMonthNames, atoiError, errBad, errLeadingInt, months, days, daysBefore, utcLoc, utcLoc$24ptr, localLoc, localLoc$24ptr, localOnce, zoneinfo, badData, zoneDirs, _tuple, _r, init, initLocal, indexByte, startsWithLowerCase, nextStdChunk, match, lookup, appendInt, atoi, formatNano, quote, isDigit, getnum, cutspace, skip, Parse, parse, parseTimeZone, parseGMT, parseNanoseconds, leadingInt, absWeekday, absClock, fmtFrac, fmtInt, absDate, daysIn, Unix, isLeap, norm, Date, div, FixedZone;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	runtime = $packages["runtime"];
	syscall = $packages["syscall"];
	ParseError = $pkg.ParseError = $newType(0, $kindStruct, "time.ParseError", true, "time", true, function(Layout_, Value_, LayoutElem_, ValueElem_, Message_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Layout = "";
			this.Value = "";
			this.LayoutElem = "";
			this.ValueElem = "";
			this.Message = "";
			return;
		}
		this.Layout = Layout_;
		this.Value = Value_;
		this.LayoutElem = LayoutElem_;
		this.ValueElem = ValueElem_;
		this.Message = Message_;
	});
	Time = $pkg.Time = $newType(0, $kindStruct, "time.Time", true, "time", true, function(sec_, nsec_, loc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sec = new $Int64(0, 0);
			this.nsec = 0;
			this.loc = ptrType$1.nil;
			return;
		}
		this.sec = sec_;
		this.nsec = nsec_;
		this.loc = loc_;
	});
	Month = $pkg.Month = $newType(4, $kindInt, "time.Month", true, "time", true, null);
	Weekday = $pkg.Weekday = $newType(4, $kindInt, "time.Weekday", true, "time", true, null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "time.Duration", true, "time", true, null);
	Location = $pkg.Location = $newType(0, $kindStruct, "time.Location", true, "time", true, function(name_, zone_, tx_, cacheStart_, cacheEnd_, cacheZone_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.zone = sliceType.nil;
			this.tx = sliceType$1.nil;
			this.cacheStart = new $Int64(0, 0);
			this.cacheEnd = new $Int64(0, 0);
			this.cacheZone = ptrType.nil;
			return;
		}
		this.name = name_;
		this.zone = zone_;
		this.tx = tx_;
		this.cacheStart = cacheStart_;
		this.cacheEnd = cacheEnd_;
		this.cacheZone = cacheZone_;
	});
	zone = $pkg.zone = $newType(0, $kindStruct, "time.zone", true, "time", false, function(name_, offset_, isDST_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.offset = 0;
			this.isDST = false;
			return;
		}
		this.name = name_;
		this.offset = offset_;
		this.isDST = isDST_;
	});
	zoneTrans = $pkg.zoneTrans = $newType(0, $kindStruct, "time.zoneTrans", true, "time", false, function(when_, index_, isstd_, isutc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.when = new $Int64(0, 0);
			this.index = 0;
			this.isstd = false;
			this.isutc = false;
			return;
		}
		this.when = when_;
		this.index = index_;
		this.isstd = isstd_;
		this.isutc = isutc_;
	});
	sliceType = $sliceType(zone);
	sliceType$1 = $sliceType(zoneTrans);
	ptrType = $ptrType(zone);
	sliceType$2 = $sliceType($String);
	arrayType = $arrayType($Uint8, 20);
	sliceType$3 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 9);
	arrayType$2 = $arrayType($Uint8, 64);
	ptrType$1 = $ptrType(Location);
	arrayType$4 = $arrayType($Uint8, 32);
	ptrType$3 = $ptrType(ParseError);
	ptrType$6 = $ptrType(Time);
	init = function() {
		var $ptr;
		Unix(new $Int64(0, 0), new $Int64(0, 0));
	};
	initLocal = function() {
		var $ptr, d, i, j, s;
		d = new ($global.Date)();
		s = $internalize(d, $String);
		i = indexByte(s, 40);
		j = indexByte(s, 41);
		if ((i === -1) || (j === -1)) {
			localLoc.name = "UTC";
			return;
		}
		localLoc.name = $substring(s, (i + 1 >> 0), j);
		localLoc.zone = new sliceType([new zone.ptr(localLoc.name, $imul(($parseInt(d.getTimezoneOffset()) >> 0), -60), false)]);
	};
	indexByte = function(s, c) {
		var $ptr, c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	startsWithLowerCase = function(str) {
		var $ptr, c, str;
		if (str.length === 0) {
			return false;
		}
		c = str.charCodeAt(0);
		return 97 <= c && c <= 122;
	};
	nextStdChunk = function(layout) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$51, _tmp$52, _tmp$53, _tmp$54, _tmp$55, _tmp$56, _tmp$57, _tmp$58, _tmp$59, _tmp$6, _tmp$60, _tmp$61, _tmp$62, _tmp$63, _tmp$64, _tmp$65, _tmp$66, _tmp$67, _tmp$68, _tmp$69, _tmp$7, _tmp$70, _tmp$71, _tmp$72, _tmp$73, _tmp$74, _tmp$75, _tmp$76, _tmp$77, _tmp$78, _tmp$79, _tmp$8, _tmp$80, _tmp$81, _tmp$82, _tmp$83, _tmp$84, _tmp$85, _tmp$86, _tmp$9, c, ch, i, j, layout, prefix, std, std$1, suffix, x;
		prefix = "";
		std = 0;
		suffix = "";
		i = 0;
		while (true) {
			if (!(i < layout.length)) { break; }
			c = (layout.charCodeAt(i) >> 0);
			_1 = c;
			if (_1 === (74)) {
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Jan") {
					if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "January") {
						_tmp = $substring(layout, 0, i);
						_tmp$1 = 257;
						_tmp$2 = $substring(layout, (i + 7 >> 0));
						prefix = _tmp;
						std = _tmp$1;
						suffix = _tmp$2;
						return [prefix, std, suffix];
					}
					if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
						_tmp$3 = $substring(layout, 0, i);
						_tmp$4 = 258;
						_tmp$5 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$3;
						std = _tmp$4;
						suffix = _tmp$5;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (77)) {
				if (layout.length >= (i + 3 >> 0)) {
					if ($substring(layout, i, (i + 3 >> 0)) === "Mon") {
						if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Monday") {
							_tmp$6 = $substring(layout, 0, i);
							_tmp$7 = 261;
							_tmp$8 = $substring(layout, (i + 6 >> 0));
							prefix = _tmp$6;
							std = _tmp$7;
							suffix = _tmp$8;
							return [prefix, std, suffix];
						}
						if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
							_tmp$9 = $substring(layout, 0, i);
							_tmp$10 = 262;
							_tmp$11 = $substring(layout, (i + 3 >> 0));
							prefix = _tmp$9;
							std = _tmp$10;
							suffix = _tmp$11;
							return [prefix, std, suffix];
						}
					}
					if ($substring(layout, i, (i + 3 >> 0)) === "MST") {
						_tmp$12 = $substring(layout, 0, i);
						_tmp$13 = 21;
						_tmp$14 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$12;
						std = _tmp$13;
						suffix = _tmp$14;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (48)) {
				if (layout.length >= (i + 2 >> 0) && 49 <= layout.charCodeAt((i + 1 >> 0)) && layout.charCodeAt((i + 1 >> 0)) <= 54) {
					_tmp$15 = $substring(layout, 0, i);
					_tmp$16 = (x = layout.charCodeAt((i + 1 >> 0)) - 49 << 24 >>> 24, ((x < 0 || x >= std0x.length) ? $throwRuntimeError("index out of range") : std0x[x]));
					_tmp$17 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$15;
					std = _tmp$16;
					suffix = _tmp$17;
					return [prefix, std, suffix];
				}
			} else if (_1 === (49)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 53)) {
					_tmp$18 = $substring(layout, 0, i);
					_tmp$19 = 522;
					_tmp$20 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$18;
					std = _tmp$19;
					suffix = _tmp$20;
					return [prefix, std, suffix];
				}
				_tmp$21 = $substring(layout, 0, i);
				_tmp$22 = 259;
				_tmp$23 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$21;
				std = _tmp$22;
				suffix = _tmp$23;
				return [prefix, std, suffix];
			} else if (_1 === (50)) {
				if (layout.length >= (i + 4 >> 0) && $substring(layout, i, (i + 4 >> 0)) === "2006") {
					_tmp$24 = $substring(layout, 0, i);
					_tmp$25 = 273;
					_tmp$26 = $substring(layout, (i + 4 >> 0));
					prefix = _tmp$24;
					std = _tmp$25;
					suffix = _tmp$26;
					return [prefix, std, suffix];
				}
				_tmp$27 = $substring(layout, 0, i);
				_tmp$28 = 263;
				_tmp$29 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$27;
				std = _tmp$28;
				suffix = _tmp$29;
				return [prefix, std, suffix];
			} else if (_1 === (95)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 50)) {
					if (layout.length >= (i + 5 >> 0) && $substring(layout, (i + 1 >> 0), (i + 5 >> 0)) === "2006") {
						_tmp$30 = $substring(layout, 0, (i + 1 >> 0));
						_tmp$31 = 273;
						_tmp$32 = $substring(layout, (i + 5 >> 0));
						prefix = _tmp$30;
						std = _tmp$31;
						suffix = _tmp$32;
						return [prefix, std, suffix];
					}
					_tmp$33 = $substring(layout, 0, i);
					_tmp$34 = 264;
					_tmp$35 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$33;
					std = _tmp$34;
					suffix = _tmp$35;
					return [prefix, std, suffix];
				}
			} else if (_1 === (51)) {
				_tmp$36 = $substring(layout, 0, i);
				_tmp$37 = 523;
				_tmp$38 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$36;
				std = _tmp$37;
				suffix = _tmp$38;
				return [prefix, std, suffix];
			} else if (_1 === (52)) {
				_tmp$39 = $substring(layout, 0, i);
				_tmp$40 = 525;
				_tmp$41 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$39;
				std = _tmp$40;
				suffix = _tmp$41;
				return [prefix, std, suffix];
			} else if (_1 === (53)) {
				_tmp$42 = $substring(layout, 0, i);
				_tmp$43 = 527;
				_tmp$44 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$42;
				std = _tmp$43;
				suffix = _tmp$44;
				return [prefix, std, suffix];
			} else if (_1 === (80)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 77)) {
					_tmp$45 = $substring(layout, 0, i);
					_tmp$46 = 531;
					_tmp$47 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$45;
					std = _tmp$46;
					suffix = _tmp$47;
					return [prefix, std, suffix];
				}
			} else if (_1 === (112)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 109)) {
					_tmp$48 = $substring(layout, 0, i);
					_tmp$49 = 532;
					_tmp$50 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$48;
					std = _tmp$49;
					suffix = _tmp$50;
					return [prefix, std, suffix];
				}
			} else if (_1 === (45)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "-070000") {
					_tmp$51 = $substring(layout, 0, i);
					_tmp$52 = 28;
					_tmp$53 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$51;
					std = _tmp$52;
					suffix = _tmp$53;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "-07:00:00") {
					_tmp$54 = $substring(layout, 0, i);
					_tmp$55 = 31;
					_tmp$56 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$54;
					std = _tmp$55;
					suffix = _tmp$56;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "-0700") {
					_tmp$57 = $substring(layout, 0, i);
					_tmp$58 = 27;
					_tmp$59 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$57;
					std = _tmp$58;
					suffix = _tmp$59;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "-07:00") {
					_tmp$60 = $substring(layout, 0, i);
					_tmp$61 = 30;
					_tmp$62 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$60;
					std = _tmp$61;
					suffix = _tmp$62;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "-07") {
					_tmp$63 = $substring(layout, 0, i);
					_tmp$64 = 29;
					_tmp$65 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$63;
					std = _tmp$64;
					suffix = _tmp$65;
					return [prefix, std, suffix];
				}
			} else if (_1 === (90)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "Z070000") {
					_tmp$66 = $substring(layout, 0, i);
					_tmp$67 = 23;
					_tmp$68 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$66;
					std = _tmp$67;
					suffix = _tmp$68;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "Z07:00:00") {
					_tmp$69 = $substring(layout, 0, i);
					_tmp$70 = 26;
					_tmp$71 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$69;
					std = _tmp$70;
					suffix = _tmp$71;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "Z0700") {
					_tmp$72 = $substring(layout, 0, i);
					_tmp$73 = 22;
					_tmp$74 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$72;
					std = _tmp$73;
					suffix = _tmp$74;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Z07:00") {
					_tmp$75 = $substring(layout, 0, i);
					_tmp$76 = 25;
					_tmp$77 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$75;
					std = _tmp$76;
					suffix = _tmp$77;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Z07") {
					_tmp$78 = $substring(layout, 0, i);
					_tmp$79 = 24;
					_tmp$80 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$78;
					std = _tmp$79;
					suffix = _tmp$80;
					return [prefix, std, suffix];
				}
			} else if (_1 === (46)) {
				if ((i + 1 >> 0) < layout.length && ((layout.charCodeAt((i + 1 >> 0)) === 48) || (layout.charCodeAt((i + 1 >> 0)) === 57))) {
					ch = layout.charCodeAt((i + 1 >> 0));
					j = i + 1 >> 0;
					while (true) {
						if (!(j < layout.length && (layout.charCodeAt(j) === ch))) { break; }
						j = j + (1) >> 0;
					}
					if (!isDigit(layout, j)) {
						std$1 = 32;
						if (layout.charCodeAt((i + 1 >> 0)) === 57) {
							std$1 = 33;
						}
						std$1 = std$1 | ((((j - ((i + 1 >> 0)) >> 0)) << 16 >> 0));
						_tmp$81 = $substring(layout, 0, i);
						_tmp$82 = std$1;
						_tmp$83 = $substring(layout, j);
						prefix = _tmp$81;
						std = _tmp$82;
						suffix = _tmp$83;
						return [prefix, std, suffix];
					}
				}
			}
			i = i + (1) >> 0;
		}
		_tmp$84 = layout;
		_tmp$85 = 0;
		_tmp$86 = "";
		prefix = _tmp$84;
		std = _tmp$85;
		suffix = _tmp$86;
		return [prefix, std, suffix];
	};
	match = function(s1, s2) {
		var $ptr, c1, c2, i, s1, s2;
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			c2 = s2.charCodeAt(i);
			if (!((c1 === c2))) {
				c1 = (c1 | (32)) >>> 0;
				c2 = (c2 | (32)) >>> 0;
				if (!((c1 === c2)) || c1 < 97 || c1 > 122) {
					return false;
				}
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	lookup = function(tab, val) {
		var $ptr, _i, _ref, i, tab, v, val;
		_ref = tab;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (val.length >= v.length && match($substring(val, 0, v.length), v)) {
				return [i, $substring(val, v.length), $ifaceNil];
			}
			_i++;
		}
		return [-1, val, errBad];
	};
	appendInt = function(b, x, width) {
		var $ptr, _q, b, buf, i, q, u, w, width, x;
		u = (x >>> 0);
		if (x < 0) {
			b = $append(b, 45);
			u = (-x >>> 0);
		}
		buf = arrayType.zero();
		i = 20;
		while (true) {
			if (!(u >= 10)) { break; }
			i = i - (1) >> 0;
			q = (_q = u / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((48 + u >>> 0) - (q * 10 >>> 0) >>> 0) << 24 >>> 24));
			u = q;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((48 + u >>> 0) << 24 >>> 24));
		w = 20 - i >> 0;
		while (true) {
			if (!(w < width)) { break; }
			b = $append(b, 48);
			w = w + (1) >> 0;
		}
		return $appendSlice(b, $subslice(new sliceType$3(buf), i));
	};
	atoi = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple$1, err, neg, q, rem, s, x;
		x = 0;
		err = $ifaceNil;
		neg = false;
		if (!(s === "") && ((s.charCodeAt(0) === 45) || (s.charCodeAt(0) === 43))) {
			neg = s.charCodeAt(0) === 45;
			s = $substring(s, 1);
		}
		_tuple$1 = leadingInt(s);
		q = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		x = ((q.$low + ((q.$high >> 31) * 4294967296)) >> 0);
		if (!($interfaceIsEqual(err, $ifaceNil)) || !(rem === "")) {
			_tmp = 0;
			_tmp$1 = atoiError;
			x = _tmp;
			err = _tmp$1;
			return [x, err];
		}
		if (neg) {
			x = -x;
		}
		_tmp$2 = x;
		_tmp$3 = $ifaceNil;
		x = _tmp$2;
		err = _tmp$3;
		return [x, err];
	};
	formatNano = function(b, nanosec, n, trim) {
		var $ptr, _q, _r$1, b, buf, n, nanosec, start, trim, u, x;
		u = nanosec;
		buf = arrayType$1.zero();
		start = 9;
		while (true) {
			if (!(start > 0)) { break; }
			start = start - (1) >> 0;
			((start < 0 || start >= buf.length) ? $throwRuntimeError("index out of range") : buf[start] = (((_r$1 = u % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			u = (_q = u / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		if (n > 9) {
			n = 9;
		}
		if (trim) {
			while (true) {
				if (!(n > 0 && ((x = n - 1 >> 0, ((x < 0 || x >= buf.length) ? $throwRuntimeError("index out of range") : buf[x])) === 48))) { break; }
				n = n - (1) >> 0;
			}
			if (n === 0) {
				return b;
			}
		}
		b = $append(b, 46);
		return $appendSlice(b, $subslice(new sliceType$3(buf), 0, n));
	};
	Time.ptr.prototype.String = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Format("2006-01-02 15:04:05.999999999 -0700 MST"); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.String = function() { return this.$val.String(); };
	Time.ptr.prototype.Format = function(layout) {
		var $ptr, _r$1, b, buf, layout, max, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; b = $f.b; buf = $f.buf; layout = $f.layout; max = $f.max; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		b = sliceType$3.nil;
		max = layout.length + 10 >> 0;
		if (max < 64) {
			buf = arrayType$2.zero();
			b = $subslice(new sliceType$3(buf), 0, 0);
		} else {
			b = $makeSlice(sliceType$3, 0, max);
		}
		_r$1 = t.AppendFormat(b, layout); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		$s = -1; return $bytesToString(b);
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Format }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.b = b; $f.buf = buf; $f.layout = layout; $f.max = max; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Format = function(layout) { return this.$val.Format(layout); };
	Time.ptr.prototype.AppendFormat = function(b, layout) {
		var $ptr, _1, _q, _q$1, _q$2, _q$3, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tuple$1, _tuple$2, _tuple$3, _tuple$4, abs, absoffset, b, day, hour, hr, hr$1, layout, m, min, month, name, offset, prefix, s, sec, std, suffix, t, y, year, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; abs = $f.abs; absoffset = $f.absoffset; b = $f.b; day = $f.day; hour = $f.hour; hr = $f.hr; hr$1 = $f.hr$1; layout = $f.layout; m = $f.m; min = $f.min; month = $f.month; name = $f.name; offset = $f.offset; prefix = $f.prefix; s = $f.s; sec = $f.sec; std = $f.std; suffix = $f.suffix; t = $f.t; y = $f.y; year = $f.year; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.locabs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		abs = _tuple$1[2];
		year = -1;
		month = 0;
		day = 0;
		hour = -1;
		min = 0;
		sec = 0;
		while (true) {
			if (!(!(layout === ""))) { break; }
			_tuple$2 = nextStdChunk(layout);
			prefix = _tuple$2[0];
			std = _tuple$2[1];
			suffix = _tuple$2[2];
			if (!(prefix === "")) {
				b = $appendSlice(b, prefix);
			}
			if (std === 0) {
				break;
			}
			layout = suffix;
			if (year < 0 && !(((std & 256) === 0))) {
				_tuple$3 = absDate(abs, true);
				year = _tuple$3[0];
				month = _tuple$3[1];
				day = _tuple$3[2];
			}
			if (hour < 0 && !(((std & 512) === 0))) {
				_tuple$4 = absClock(abs);
				hour = _tuple$4[0];
				min = _tuple$4[1];
				sec = _tuple$4[2];
			}
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					y = year;
					if (y < 0) {
						y = -y;
					}
					b = appendInt(b, (_r$2 = y % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")), 2);
				} else if (_1 === (273)) {
					b = appendInt(b, year, 4);
				} else if (_1 === (258)) {
					b = $appendSlice(b, $substring(new Month(month).String(), 0, 3));
				} else if (_1 === (257)) {
					m = new Month(month).String();
					b = $appendSlice(b, m);
				} else if (_1 === (259)) {
					b = appendInt(b, (month >> 0), 0);
				} else if (_1 === (260)) {
					b = appendInt(b, (month >> 0), 2);
				} else if (_1 === (262)) {
					b = $appendSlice(b, $substring(new Weekday(absWeekday(abs)).String(), 0, 3));
				} else if (_1 === (261)) {
					s = new Weekday(absWeekday(abs)).String();
					b = $appendSlice(b, s);
				} else if (_1 === (263)) {
					b = appendInt(b, day, 0);
				} else if (_1 === (264)) {
					if (day < 10) {
						b = $append(b, 32);
					}
					b = appendInt(b, day, 0);
				} else if (_1 === (265)) {
					b = appendInt(b, day, 2);
				} else if (_1 === (522)) {
					b = appendInt(b, hour, 2);
				} else if (_1 === (523)) {
					hr = (_r$3 = hour % 12, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
					if (hr === 0) {
						hr = 12;
					}
					b = appendInt(b, hr, 0);
				} else if (_1 === (524)) {
					hr$1 = (_r$4 = hour % 12, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
					if (hr$1 === 0) {
						hr$1 = 12;
					}
					b = appendInt(b, hr$1, 2);
				} else if (_1 === (525)) {
					b = appendInt(b, min, 0);
				} else if (_1 === (526)) {
					b = appendInt(b, min, 2);
				} else if (_1 === (527)) {
					b = appendInt(b, sec, 0);
				} else if (_1 === (528)) {
					b = appendInt(b, sec, 2);
				} else if (_1 === (531)) {
					if (hour >= 12) {
						b = $appendSlice(b, "PM");
					} else {
						b = $appendSlice(b, "AM");
					}
				} else if (_1 === (532)) {
					if (hour >= 12) {
						b = $appendSlice(b, "pm");
					} else {
						b = $appendSlice(b, "am");
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (30)) || (_1 === (28)) || (_1 === (29)) || (_1 === (31))) {
					if ((offset === 0) && ((std === 22) || (std === 25) || (std === 23) || (std === 24) || (std === 26))) {
						b = $append(b, 90);
						break;
					}
					zone$1 = (_q = offset / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					absoffset = offset;
					if (zone$1 < 0) {
						b = $append(b, 45);
						zone$1 = -zone$1;
						absoffset = -absoffset;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$1 = zone$1 / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					if ((std === 25) || (std === 30) || (std === 26) || (std === 31)) {
						b = $append(b, 58);
					}
					if (!((std === 29)) && !((std === 24))) {
						b = appendInt(b, (_r$5 = zone$1 % 60, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero")), 2);
					}
					if ((std === 23) || (std === 28) || (std === 31) || (std === 26)) {
						if ((std === 31) || (std === 26)) {
							b = $append(b, 58);
						}
						b = appendInt(b, (_r$6 = absoffset % 60, _r$6 === _r$6 ? _r$6 : $throwRuntimeError("integer divide by zero")), 2);
					}
				} else if (_1 === (21)) {
					if (!(name === "")) {
						b = $appendSlice(b, name);
						break;
					}
					zone$2 = (_q$2 = offset / 60, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					if (zone$2 < 0) {
						b = $append(b, 45);
						zone$2 = -zone$2;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$3 = zone$2 / 60, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					b = appendInt(b, (_r$7 = zone$2 % 60, _r$7 === _r$7 ? _r$7 : $throwRuntimeError("integer divide by zero")), 2);
				} else if ((_1 === (32)) || (_1 === (33))) {
					b = formatNano(b, (t.Nanosecond() >>> 0), std >> 16 >> 0, (std & 65535) === 33);
				}
			}
		}
		$s = -1; return b;
		return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AppendFormat }; } $f.$ptr = $ptr; $f._1 = _1; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.abs = abs; $f.absoffset = absoffset; $f.b = b; $f.day = day; $f.hour = hour; $f.hr = hr; $f.hr$1 = hr$1; $f.layout = layout; $f.m = m; $f.min = min; $f.month = month; $f.name = name; $f.offset = offset; $f.prefix = prefix; $f.s = s; $f.sec = sec; $f.std = std; $f.suffix = suffix; $f.t = t; $f.y = y; $f.year = year; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AppendFormat = function(b, layout) { return this.$val.AppendFormat(b, layout); };
	quote = function(s) {
		var $ptr, s;
		return "\"" + s + "\"";
	};
	ParseError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Message === "") {
			return "parsing time " + quote(e.Value) + " as " + quote(e.Layout) + ": cannot parse " + quote(e.ValueElem) + " as " + quote(e.LayoutElem);
		}
		return "parsing time " + quote(e.Value) + e.Message;
	};
	ParseError.prototype.Error = function() { return this.$val.Error(); };
	isDigit = function(s, i) {
		var $ptr, c, i, s;
		if (s.length <= i) {
			return false;
		}
		c = s.charCodeAt(i);
		return 48 <= c && c <= 57;
	};
	getnum = function(s, fixed) {
		var $ptr, fixed, s;
		if (!isDigit(s, 0)) {
			return [0, s, errBad];
		}
		if (!isDigit(s, 1)) {
			if (fixed) {
				return [0, s, errBad];
			}
			return [((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), $substring(s, 1), $ifaceNil];
		}
		return [($imul(((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), 10)) + ((s.charCodeAt(1) - 48 << 24 >>> 24) >> 0) >> 0, $substring(s, 2), $ifaceNil];
	};
	cutspace = function(s) {
		var $ptr, s;
		while (true) {
			if (!(s.length > 0 && (s.charCodeAt(0) === 32))) { break; }
			s = $substring(s, 1);
		}
		return s;
	};
	skip = function(value, prefix) {
		var $ptr, prefix, value;
		while (true) {
			if (!(prefix.length > 0)) { break; }
			if (prefix.charCodeAt(0) === 32) {
				if (value.length > 0 && !((value.charCodeAt(0) === 32))) {
					return [value, errBad];
				}
				prefix = cutspace(prefix);
				value = cutspace(value);
				continue;
			}
			if ((value.length === 0) || !((value.charCodeAt(0) === prefix.charCodeAt(0)))) {
				return [value, errBad];
			}
			prefix = $substring(prefix, 1);
			value = $substring(value, 1);
		}
		return [value, $ifaceNil];
	};
	Parse = function(layout, value) {
		var $ptr, _r$1, layout, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; layout = $f.layout; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r$1 = parse(layout, value, $pkg.UTC, $pkg.Local); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.layout = layout; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parse = function(layout, value, defaultLocation, local) {
		var $ptr, _1, _2, _3, _4, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$16, _tuple$17, _tuple$18, _tuple$19, _tuple$2, _tuple$20, _tuple$21, _tuple$22, _tuple$23, _tuple$24, _tuple$25, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, alayout, amSet, avalue, day, defaultLocation, err, hour, hour$1, hr, i, layout, local, min, min$1, mm, month, n, n$1, name, ndigit, nsec, offset, offset$1, ok, ok$1, p, pmSet, prefix, rangeErrString, sec, seconds, sign, ss, std, stdstr, suffix, t, t$1, value, x, x$1, x$2, x$3, x$4, x$5, year, z, zoneName, zoneOffset, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$22 = $f._tmp$22; _tmp$23 = $f._tmp$23; _tmp$24 = $f._tmp$24; _tmp$25 = $f._tmp$25; _tmp$26 = $f._tmp$26; _tmp$27 = $f._tmp$27; _tmp$28 = $f._tmp$28; _tmp$29 = $f._tmp$29; _tmp$3 = $f._tmp$3; _tmp$30 = $f._tmp$30; _tmp$31 = $f._tmp$31; _tmp$32 = $f._tmp$32; _tmp$33 = $f._tmp$33; _tmp$34 = $f._tmp$34; _tmp$35 = $f._tmp$35; _tmp$36 = $f._tmp$36; _tmp$37 = $f._tmp$37; _tmp$38 = $f._tmp$38; _tmp$39 = $f._tmp$39; _tmp$4 = $f._tmp$4; _tmp$40 = $f._tmp$40; _tmp$41 = $f._tmp$41; _tmp$42 = $f._tmp$42; _tmp$43 = $f._tmp$43; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$16 = $f._tuple$16; _tuple$17 = $f._tuple$17; _tuple$18 = $f._tuple$18; _tuple$19 = $f._tuple$19; _tuple$2 = $f._tuple$2; _tuple$20 = $f._tuple$20; _tuple$21 = $f._tuple$21; _tuple$22 = $f._tuple$22; _tuple$23 = $f._tuple$23; _tuple$24 = $f._tuple$24; _tuple$25 = $f._tuple$25; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; alayout = $f.alayout; amSet = $f.amSet; avalue = $f.avalue; day = $f.day; defaultLocation = $f.defaultLocation; err = $f.err; hour = $f.hour; hour$1 = $f.hour$1; hr = $f.hr; i = $f.i; layout = $f.layout; local = $f.local; min = $f.min; min$1 = $f.min$1; mm = $f.mm; month = $f.month; n = $f.n; n$1 = $f.n$1; name = $f.name; ndigit = $f.ndigit; nsec = $f.nsec; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; pmSet = $f.pmSet; prefix = $f.prefix; rangeErrString = $f.rangeErrString; sec = $f.sec; seconds = $f.seconds; sign = $f.sign; ss = $f.ss; std = $f.std; stdstr = $f.stdstr; suffix = $f.suffix; t = $f.t; t$1 = $f.t$1; value = $f.value; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; year = $f.year; z = $f.z; zoneName = $f.zoneName; zoneOffset = $f.zoneOffset; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = layout;
		_tmp$1 = value;
		alayout = _tmp;
		avalue = _tmp$1;
		rangeErrString = "";
		amSet = false;
		pmSet = false;
		year = 0;
		month = 1;
		day = 1;
		hour = 0;
		min = 0;
		sec = 0;
		nsec = 0;
		z = ptrType$1.nil;
		zoneOffset = -1;
		zoneName = "";
		while (true) {
			err = $ifaceNil;
			_tuple$1 = nextStdChunk(layout);
			prefix = _tuple$1[0];
			std = _tuple$1[1];
			suffix = _tuple$1[2];
			stdstr = $substring(layout, prefix.length, (layout.length - suffix.length >> 0));
			_tuple$2 = skip(value, prefix);
			value = _tuple$2[0];
			err = _tuple$2[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
			}
			if (std === 0) {
				if (!((value.length === 0))) {
					$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
					return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
				}
				break;
			}
			layout = suffix;
			p = "";
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$2 = $substring(value, 0, 2);
					_tmp$3 = $substring(value, 2);
					p = _tmp$2;
					value = _tmp$3;
					_tuple$3 = atoi(p);
					year = _tuple$3[0];
					err = _tuple$3[1];
					if (year >= 69) {
						year = year + (1900) >> 0;
					} else {
						year = year + (2000) >> 0;
					}
				} else if (_1 === (273)) {
					if (value.length < 4 || !isDigit(value, 0)) {
						err = errBad;
						break;
					}
					_tmp$4 = $substring(value, 0, 4);
					_tmp$5 = $substring(value, 4);
					p = _tmp$4;
					value = _tmp$5;
					_tuple$4 = atoi(p);
					year = _tuple$4[0];
					err = _tuple$4[1];
				} else if (_1 === (258)) {
					_tuple$5 = lookup(shortMonthNames, value);
					month = _tuple$5[0];
					value = _tuple$5[1];
					err = _tuple$5[2];
				} else if (_1 === (257)) {
					_tuple$6 = lookup(longMonthNames, value);
					month = _tuple$6[0];
					value = _tuple$6[1];
					err = _tuple$6[2];
				} else if ((_1 === (259)) || (_1 === (260))) {
					_tuple$7 = getnum(value, std === 260);
					month = _tuple$7[0];
					value = _tuple$7[1];
					err = _tuple$7[2];
					if (month <= 0 || 12 < month) {
						rangeErrString = "month";
					}
				} else if (_1 === (262)) {
					_tuple$8 = lookup(shortDayNames, value);
					value = _tuple$8[1];
					err = _tuple$8[2];
				} else if (_1 === (261)) {
					_tuple$9 = lookup(longDayNames, value);
					value = _tuple$9[1];
					err = _tuple$9[2];
				} else if ((_1 === (263)) || (_1 === (264)) || (_1 === (265))) {
					if ((std === 264) && value.length > 0 && (value.charCodeAt(0) === 32)) {
						value = $substring(value, 1);
					}
					_tuple$10 = getnum(value, std === 265);
					day = _tuple$10[0];
					value = _tuple$10[1];
					err = _tuple$10[2];
					if (day < 0) {
						rangeErrString = "day";
					}
				} else if (_1 === (522)) {
					_tuple$11 = getnum(value, false);
					hour = _tuple$11[0];
					value = _tuple$11[1];
					err = _tuple$11[2];
					if (hour < 0 || 24 <= hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (523)) || (_1 === (524))) {
					_tuple$12 = getnum(value, std === 524);
					hour = _tuple$12[0];
					value = _tuple$12[1];
					err = _tuple$12[2];
					if (hour < 0 || 12 < hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (525)) || (_1 === (526))) {
					_tuple$13 = getnum(value, std === 526);
					min = _tuple$13[0];
					value = _tuple$13[1];
					err = _tuple$13[2];
					if (min < 0 || 60 <= min) {
						rangeErrString = "minute";
					}
				} else if ((_1 === (527)) || (_1 === (528))) {
					_tuple$14 = getnum(value, std === 528);
					sec = _tuple$14[0];
					value = _tuple$14[1];
					err = _tuple$14[2];
					if (sec < 0 || 60 <= sec) {
						rangeErrString = "second";
					}
					if (value.length >= 2 && (value.charCodeAt(0) === 46) && isDigit(value, 1)) {
						_tuple$15 = nextStdChunk(layout);
						std = _tuple$15[1];
						std = std & (65535);
						if ((std === 32) || (std === 33)) {
							break;
						}
						n = 2;
						while (true) {
							if (!(n < value.length && isDigit(value, n))) { break; }
							n = n + (1) >> 0;
						}
						_tuple$16 = parseNanoseconds(value, n);
						nsec = _tuple$16[0];
						rangeErrString = _tuple$16[1];
						err = _tuple$16[2];
						value = $substring(value, n);
					}
				} else if (_1 === (531)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$6 = $substring(value, 0, 2);
					_tmp$7 = $substring(value, 2);
					p = _tmp$6;
					value = _tmp$7;
					_2 = p;
					if (_2 === ("PM")) {
						pmSet = true;
					} else if (_2 === ("AM")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if (_1 === (532)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$8 = $substring(value, 0, 2);
					_tmp$9 = $substring(value, 2);
					p = _tmp$8;
					value = _tmp$9;
					_3 = p;
					if (_3 === ("pm")) {
						pmSet = true;
					} else if (_3 === ("am")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (29)) || (_1 === (30)) || (_1 === (28)) || (_1 === (31))) {
					if (((std === 22) || (std === 24) || (std === 25)) && value.length >= 1 && (value.charCodeAt(0) === 90)) {
						value = $substring(value, 1);
						z = $pkg.UTC;
						break;
					}
					_tmp$10 = "";
					_tmp$11 = "";
					_tmp$12 = "";
					_tmp$13 = "";
					sign = _tmp$10;
					hour$1 = _tmp$11;
					min$1 = _tmp$12;
					seconds = _tmp$13;
					if ((std === 25) || (std === 30)) {
						if (value.length < 6) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58))) {
							err = errBad;
							break;
						}
						_tmp$14 = $substring(value, 0, 1);
						_tmp$15 = $substring(value, 1, 3);
						_tmp$16 = $substring(value, 4, 6);
						_tmp$17 = "00";
						_tmp$18 = $substring(value, 6);
						sign = _tmp$14;
						hour$1 = _tmp$15;
						min$1 = _tmp$16;
						seconds = _tmp$17;
						value = _tmp$18;
					} else if ((std === 29) || (std === 24)) {
						if (value.length < 3) {
							err = errBad;
							break;
						}
						_tmp$19 = $substring(value, 0, 1);
						_tmp$20 = $substring(value, 1, 3);
						_tmp$21 = "00";
						_tmp$22 = "00";
						_tmp$23 = $substring(value, 3);
						sign = _tmp$19;
						hour$1 = _tmp$20;
						min$1 = _tmp$21;
						seconds = _tmp$22;
						value = _tmp$23;
					} else if ((std === 26) || (std === 31)) {
						if (value.length < 9) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58)) || !((value.charCodeAt(6) === 58))) {
							err = errBad;
							break;
						}
						_tmp$24 = $substring(value, 0, 1);
						_tmp$25 = $substring(value, 1, 3);
						_tmp$26 = $substring(value, 4, 6);
						_tmp$27 = $substring(value, 7, 9);
						_tmp$28 = $substring(value, 9);
						sign = _tmp$24;
						hour$1 = _tmp$25;
						min$1 = _tmp$26;
						seconds = _tmp$27;
						value = _tmp$28;
					} else if ((std === 23) || (std === 28)) {
						if (value.length < 7) {
							err = errBad;
							break;
						}
						_tmp$29 = $substring(value, 0, 1);
						_tmp$30 = $substring(value, 1, 3);
						_tmp$31 = $substring(value, 3, 5);
						_tmp$32 = $substring(value, 5, 7);
						_tmp$33 = $substring(value, 7);
						sign = _tmp$29;
						hour$1 = _tmp$30;
						min$1 = _tmp$31;
						seconds = _tmp$32;
						value = _tmp$33;
					} else {
						if (value.length < 5) {
							err = errBad;
							break;
						}
						_tmp$34 = $substring(value, 0, 1);
						_tmp$35 = $substring(value, 1, 3);
						_tmp$36 = $substring(value, 3, 5);
						_tmp$37 = "00";
						_tmp$38 = $substring(value, 5);
						sign = _tmp$34;
						hour$1 = _tmp$35;
						min$1 = _tmp$36;
						seconds = _tmp$37;
						value = _tmp$38;
					}
					_tmp$39 = 0;
					_tmp$40 = 0;
					_tmp$41 = 0;
					hr = _tmp$39;
					mm = _tmp$40;
					ss = _tmp$41;
					_tuple$17 = atoi(hour$1);
					hr = _tuple$17[0];
					err = _tuple$17[1];
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$18 = atoi(min$1);
						mm = _tuple$18[0];
						err = _tuple$18[1];
					}
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$19 = atoi(seconds);
						ss = _tuple$19[0];
						err = _tuple$19[1];
					}
					zoneOffset = ($imul(((($imul(hr, 60)) + mm >> 0)), 60)) + ss >> 0;
					_4 = sign.charCodeAt(0);
					if (_4 === (43)) {
					} else if (_4 === (45)) {
						zoneOffset = -zoneOffset;
					} else {
						err = errBad;
					}
				} else if (_1 === (21)) {
					if (value.length >= 3 && $substring(value, 0, 3) === "UTC") {
						z = $pkg.UTC;
						value = $substring(value, 3);
						break;
					}
					_tuple$20 = parseTimeZone(value);
					n$1 = _tuple$20[0];
					ok = _tuple$20[1];
					if (!ok) {
						err = errBad;
						break;
					}
					_tmp$42 = $substring(value, 0, n$1);
					_tmp$43 = $substring(value, n$1);
					zoneName = _tmp$42;
					value = _tmp$43;
				} else if (_1 === (32)) {
					ndigit = 1 + ((std >> 16 >> 0)) >> 0;
					if (value.length < ndigit) {
						err = errBad;
						break;
					}
					_tuple$21 = parseNanoseconds(value, ndigit);
					nsec = _tuple$21[0];
					rangeErrString = _tuple$21[1];
					err = _tuple$21[2];
					value = $substring(value, ndigit);
				} else if (_1 === (33)) {
					if (value.length < 2 || !((value.charCodeAt(0) === 46)) || value.charCodeAt(1) < 48 || 57 < value.charCodeAt(1)) {
						break;
					}
					i = 0;
					while (true) {
						if (!(i < 9 && (i + 1 >> 0) < value.length && 48 <= value.charCodeAt((i + 1 >> 0)) && value.charCodeAt((i + 1 >> 0)) <= 57)) { break; }
						i = i + (1) >> 0;
					}
					_tuple$22 = parseNanoseconds(value, 1 + i >> 0);
					nsec = _tuple$22[0];
					rangeErrString = _tuple$22[1];
					err = _tuple$22[2];
					value = $substring(value, (1 + i >> 0));
				}
			}
			if (!(rangeErrString === "")) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
			}
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
			}
		}
		if (pmSet && hour < 12) {
			hour = hour + (12) >> 0;
		} else if (amSet && (hour === 12)) {
			hour = 0;
		}
		if (day > daysIn((month >> 0), year)) {
			$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
			return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
		}
		/* */ if (!(z === ptrType$1.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(z === ptrType$1.nil)) { */ case 1:
			_r$1 = Date(year, (month >> 0), day, hour, min, sec, nsec, z); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return [_r$1, $ifaceNil];
			return [_r$1, $ifaceNil];
		/* } */ case 2:
		/* */ if (!((zoneOffset === -1))) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!((zoneOffset === -1))) { */ case 4:
			_r$2 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			t = $clone(_r$2, Time);
			t.sec = (x = t.sec, x$1 = new $Int64(0, zoneOffset), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low));
			_r$3 = local.lookup((x$2 = t.sec, new $Int64(x$2.$high + -15, x$2.$low + 2288912640))); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$23 = _r$3;
			name = _tuple$23[0];
			offset = _tuple$23[1];
			if ((offset === zoneOffset) && (zoneName === "" || name === zoneName)) {
				t.loc = local;
				$s = -1; return [t, $ifaceNil];
				return [t, $ifaceNil];
			}
			t.loc = FixedZone(zoneName, zoneOffset);
			$s = -1; return [t, $ifaceNil];
			return [t, $ifaceNil];
		/* } */ case 5:
		/* */ if (!(zoneName === "")) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!(zoneName === "")) { */ case 8:
			_r$4 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 10; case 10: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			t$1 = $clone(_r$4, Time);
			_r$5 = local.lookupName(zoneName, (x$3 = t$1.sec, new $Int64(x$3.$high + -15, x$3.$low + 2288912640))); /* */ $s = 11; case 11: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_tuple$24 = _r$5;
			offset$1 = _tuple$24[0];
			ok$1 = _tuple$24[2];
			if (ok$1) {
				t$1.sec = (x$4 = t$1.sec, x$5 = new $Int64(0, offset$1), new $Int64(x$4.$high - x$5.$high, x$4.$low - x$5.$low));
				t$1.loc = local;
				$s = -1; return [t$1, $ifaceNil];
				return [t$1, $ifaceNil];
			}
			if (zoneName.length > 3 && $substring(zoneName, 0, 3) === "GMT") {
				_tuple$25 = atoi($substring(zoneName, 3));
				offset$1 = _tuple$25[0];
				offset$1 = $imul(offset$1, (3600));
			}
			t$1.loc = FixedZone(zoneName, offset$1);
			$s = -1; return [t$1, $ifaceNil];
			return [t$1, $ifaceNil];
		/* } */ case 9:
		_r$6 = Date(year, (month >> 0), day, hour, min, sec, nsec, defaultLocation); /* */ $s = 12; case 12: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		$s = -1; return [_r$6, $ifaceNil];
		return [_r$6, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parse }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$22 = _tmp$22; $f._tmp$23 = _tmp$23; $f._tmp$24 = _tmp$24; $f._tmp$25 = _tmp$25; $f._tmp$26 = _tmp$26; $f._tmp$27 = _tmp$27; $f._tmp$28 = _tmp$28; $f._tmp$29 = _tmp$29; $f._tmp$3 = _tmp$3; $f._tmp$30 = _tmp$30; $f._tmp$31 = _tmp$31; $f._tmp$32 = _tmp$32; $f._tmp$33 = _tmp$33; $f._tmp$34 = _tmp$34; $f._tmp$35 = _tmp$35; $f._tmp$36 = _tmp$36; $f._tmp$37 = _tmp$37; $f._tmp$38 = _tmp$38; $f._tmp$39 = _tmp$39; $f._tmp$4 = _tmp$4; $f._tmp$40 = _tmp$40; $f._tmp$41 = _tmp$41; $f._tmp$42 = _tmp$42; $f._tmp$43 = _tmp$43; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$16 = _tuple$16; $f._tuple$17 = _tuple$17; $f._tuple$18 = _tuple$18; $f._tuple$19 = _tuple$19; $f._tuple$2 = _tuple$2; $f._tuple$20 = _tuple$20; $f._tuple$21 = _tuple$21; $f._tuple$22 = _tuple$22; $f._tuple$23 = _tuple$23; $f._tuple$24 = _tuple$24; $f._tuple$25 = _tuple$25; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.alayout = alayout; $f.amSet = amSet; $f.avalue = avalue; $f.day = day; $f.defaultLocation = defaultLocation; $f.err = err; $f.hour = hour; $f.hour$1 = hour$1; $f.hr = hr; $f.i = i; $f.layout = layout; $f.local = local; $f.min = min; $f.min$1 = min$1; $f.mm = mm; $f.month = month; $f.n = n; $f.n$1 = n$1; $f.name = name; $f.ndigit = ndigit; $f.nsec = nsec; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.pmSet = pmSet; $f.prefix = prefix; $f.rangeErrString = rangeErrString; $f.sec = sec; $f.seconds = seconds; $f.sign = sign; $f.ss = ss; $f.std = std; $f.stdstr = stdstr; $f.suffix = suffix; $f.t = t; $f.t$1 = t$1; $f.value = value; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.year = year; $f.z = z; $f.zoneName = zoneName; $f.zoneOffset = zoneOffset; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseTimeZone = function(value) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, length, nUpper, ok, value;
		length = 0;
		ok = false;
		if (value.length < 3) {
			_tmp = 0;
			_tmp$1 = false;
			length = _tmp;
			ok = _tmp$1;
			return [length, ok];
		}
		if (value.length >= 4 && ($substring(value, 0, 4) === "ChST" || $substring(value, 0, 4) === "MeST")) {
			_tmp$2 = 4;
			_tmp$3 = true;
			length = _tmp$2;
			ok = _tmp$3;
			return [length, ok];
		}
		if ($substring(value, 0, 3) === "GMT") {
			length = parseGMT(value);
			_tmp$4 = length;
			_tmp$5 = true;
			length = _tmp$4;
			ok = _tmp$5;
			return [length, ok];
		}
		nUpper = 0;
		nUpper = 0;
		while (true) {
			if (!(nUpper < 6)) { break; }
			if (nUpper >= value.length) {
				break;
			}
			c = value.charCodeAt(nUpper);
			if (c < 65 || 90 < c) {
				break;
			}
			nUpper = nUpper + (1) >> 0;
		}
		_1 = nUpper;
		if ((_1 === (0)) || (_1 === (1)) || (_1 === (2)) || (_1 === (6))) {
			_tmp$6 = 0;
			_tmp$7 = false;
			length = _tmp$6;
			ok = _tmp$7;
			return [length, ok];
		} else if (_1 === (5)) {
			if (value.charCodeAt(4) === 84) {
				_tmp$8 = 5;
				_tmp$9 = true;
				length = _tmp$8;
				ok = _tmp$9;
				return [length, ok];
			}
		} else if (_1 === (4)) {
			if (value.charCodeAt(3) === 84) {
				_tmp$10 = 4;
				_tmp$11 = true;
				length = _tmp$10;
				ok = _tmp$11;
				return [length, ok];
			}
		} else if (_1 === (3)) {
			_tmp$12 = 3;
			_tmp$13 = true;
			length = _tmp$12;
			ok = _tmp$13;
			return [length, ok];
		}
		_tmp$14 = 0;
		_tmp$15 = false;
		length = _tmp$14;
		ok = _tmp$15;
		return [length, ok];
	};
	parseGMT = function(value) {
		var $ptr, _tuple$1, err, rem, sign, value, x;
		value = $substring(value, 3);
		if (value.length === 0) {
			return 3;
		}
		sign = value.charCodeAt(0);
		if (!((sign === 45)) && !((sign === 43))) {
			return 3;
		}
		_tuple$1 = leadingInt($substring(value, 1));
		x = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return 3;
		}
		if (sign === 45) {
			x = new $Int64(-x.$high, -x.$low);
		}
		if ((x.$high === 0 && x.$low === 0) || (x.$high < -1 || (x.$high === -1 && x.$low < 4294967282)) || (0 < x.$high || (0 === x.$high && 12 < x.$low))) {
			return 3;
		}
		return (3 + value.length >> 0) - rem.length >> 0;
	};
	parseNanoseconds = function(value, nbytes) {
		var $ptr, _tuple$1, err, i, nbytes, ns, rangeErrString, scaleDigits, value;
		ns = 0;
		rangeErrString = "";
		err = $ifaceNil;
		if (!((value.charCodeAt(0) === 46))) {
			err = errBad;
			return [ns, rangeErrString, err];
		}
		_tuple$1 = atoi($substring(value, 1, nbytes));
		ns = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ns, rangeErrString, err];
		}
		if (ns < 0 || 1000000000 <= ns) {
			rangeErrString = "fractional second";
			return [ns, rangeErrString, err];
		}
		scaleDigits = 10 - nbytes >> 0;
		i = 0;
		while (true) {
			if (!(i < scaleDigits)) { break; }
			ns = $imul(ns, (10));
			i = i + (1) >> 0;
		}
		return [ns, rangeErrString, err];
	};
	leadingInt = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, c, err, i, rem, s, x, x$1, x$2, x$3;
		x = new $Int64(0, 0);
		rem = "";
		err = $ifaceNil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c < 48 || c > 57) {
				break;
			}
			if ((x.$high > 214748364 || (x.$high === 214748364 && x.$low > 3435973836))) {
				_tmp = new $Int64(0, 0);
				_tmp$1 = "";
				_tmp$2 = errLeadingInt;
				x = _tmp;
				rem = _tmp$1;
				err = _tmp$2;
				return [x, rem, err];
			}
			x = (x$1 = (x$2 = $mul64(x, new $Int64(0, 10)), x$3 = new $Int64(0, c), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low)), new $Int64(x$1.$high - 0, x$1.$low - 48));
			if ((x.$high < 0 || (x.$high === 0 && x.$low < 0))) {
				_tmp$3 = new $Int64(0, 0);
				_tmp$4 = "";
				_tmp$5 = errLeadingInt;
				x = _tmp$3;
				rem = _tmp$4;
				err = _tmp$5;
				return [x, rem, err];
			}
			i = i + (1) >> 0;
		}
		_tmp$6 = x;
		_tmp$7 = $substring(s, i);
		_tmp$8 = $ifaceNil;
		x = _tmp$6;
		rem = _tmp$7;
		err = _tmp$8;
		return [x, rem, err];
	};
	Time.ptr.prototype.After = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low > x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec > u.nsec;
	};
	Time.prototype.After = function(u) { return this.$val.After(u); };
	Time.ptr.prototype.Before = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high < x$1.$high || (x.$high === x$1.$high && x.$low < x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec < u.nsec;
	};
	Time.prototype.Before = function(u) { return this.$val.Before(u); };
	Time.ptr.prototype.Equal = function(u) {
		var $ptr, t, u, x, x$1;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high === x$1.$high && x.$low === x$1.$low)) && (t.nsec === u.nsec);
	};
	Time.prototype.Equal = function(u) { return this.$val.Equal(u); };
	Month.prototype.String = function() {
		var $ptr, m, x;
		m = this.$val;
		return (x = m - 1 >> 0, ((x < 0 || x >= months.length) ? $throwRuntimeError("index out of range") : months[x]));
	};
	$ptrType(Month).prototype.String = function() { return new Month(this.$get()).String(); };
	Weekday.prototype.String = function() {
		var $ptr, d;
		d = this.$val;
		return ((d < 0 || d >= days.length) ? $throwRuntimeError("index out of range") : days[d]);
	};
	$ptrType(Weekday).prototype.String = function() { return new Weekday(this.$get()).String(); };
	Time.ptr.prototype.IsZero = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, (x.$high === 0 && x.$low === 0)) && (t.nsec === 0);
	};
	Time.prototype.IsZero = function() { return this.$val.IsZero(); };
	Time.ptr.prototype.abs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, l, offset, sec, t, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; l = $f.l; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 6:
				sec = (x$3 = new $Int64(0, l.cacheZone.offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
				$s = 8; continue;
			/* } else { */ case 7:
				_r$2 = l.lookup(sec); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				offset = _tuple$1[1];
				sec = (x$4 = new $Int64(0, offset), new $Int64(sec.$high + x$4.$high, sec.$low + x$4.$low));
			/* } */ case 8:
		/* } */ case 5:
		$s = -1; return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.abs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.l = l; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.abs = function() { return this.$val.abs(); };
	Time.ptr.prototype.locabs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, abs, l, name, offset, sec, t, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; abs = $f.abs; l = $f.l; name = $f.name; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		abs = new $Uint64(0, 0);
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 7:
				name = l.cacheZone.name;
				offset = l.cacheZone.offset;
				$s = 9; continue;
			/* } else { */ case 8:
				_r$2 = l.lookup(sec); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				name = _tuple$1[0];
				offset = _tuple$1[1];
			/* } */ case 9:
			sec = (x$3 = new $Int64(0, offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
			$s = 6; continue;
		/* } else { */ case 5:
			name = "UTC";
		/* } */ case 6:
		abs = (x$4 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$4.$high, x$4.$low));
		$s = -1; return [name, offset, abs];
		return [name, offset, abs];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.locabs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.abs = abs; $f.l = l; $f.name = name; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.locabs = function() { return this.$val.locabs(); };
	Time.ptr.prototype.Date = function() {
		var $ptr, _r$1, _tuple$1, day, month, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; month = $f.month; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		$s = -1; return [year, month, day];
		return [year, month, day];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.month = month; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Date = function() { return this.$val.Date(); };
	Time.ptr.prototype.Year = function() {
		var $ptr, _r$1, _tuple$1, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		$s = -1; return year;
		return year;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Year }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Year = function() { return this.$val.Year(); };
	Time.ptr.prototype.Month = function() {
		var $ptr, _r$1, _tuple$1, month, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; month = $f.month; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		month = _tuple$1[1];
		$s = -1; return month;
		return month;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Month }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.month = month; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Month = function() { return this.$val.Month(); };
	Time.ptr.prototype.Day = function() {
		var $ptr, _r$1, _tuple$1, day, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		day = _tuple$1[2];
		$s = -1; return day;
		return day;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Day }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Day = function() { return this.$val.Day(); };
	Time.ptr.prototype.Weekday = function() {
		var $ptr, _r$1, _r$2, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absWeekday(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Weekday }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Weekday = function() { return this.$val.Weekday(); };
	absWeekday = function(abs) {
		var $ptr, _q, abs, sec;
		sec = $div64((new $Uint64(abs.$high + 0, abs.$low + 86400)), new $Uint64(0, 604800), true);
		return ((_q = (sec.$low >> 0) / 86400, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
	};
	Time.ptr.prototype.ISOWeek = function() {
		var $ptr, _q, _r$1, _r$2, _r$3, _r$4, _r$5, _tuple$1, day, dec31wday, jan1wday, month, t, wday, week, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _tuple$1 = $f._tuple$1; day = $f.day; dec31wday = $f.dec31wday; jan1wday = $f.jan1wday; month = $f.month; t = $f.t; wday = $f.wday; week = $f.week; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		week = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		_r$3 = t.Weekday(); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		wday = (_r$2 = ((_r$3 + 6 >> 0) >> 0) % 7, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero"));
		week = (_q = (((yday - wday >> 0) + 7 >> 0)) / 7, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		jan1wday = (_r$4 = (((wday - yday >> 0) + 371 >> 0)) % 7, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		if (1 <= jan1wday && jan1wday <= 3) {
			week = week + (1) >> 0;
		}
		if (week === 0) {
			year = year - (1) >> 0;
			week = 52;
			if ((jan1wday === 4) || ((jan1wday === 5) && isLeap(year))) {
				week = week + (1) >> 0;
			}
		}
		if ((month === 12) && day >= 29 && wday < 3) {
			dec31wday = (_r$5 = (((wday + 31 >> 0) - day >> 0)) % 7, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero"));
			if (0 <= dec31wday && dec31wday <= 2) {
				year = year + (1) >> 0;
				week = 1;
			}
		}
		$s = -1; return [year, week];
		return [year, week];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.ISOWeek }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._tuple$1 = _tuple$1; $f.day = day; $f.dec31wday = dec31wday; $f.jan1wday = jan1wday; $f.month = month; $f.t = t; $f.wday = wday; $f.week = week; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.ISOWeek = function() { return this.$val.ISOWeek(); };
	Time.ptr.prototype.Clock = function() {
		var $ptr, _r$1, _r$2, _tuple$1, hour, min, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; hour = $f.hour; min = $f.min; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		hour = 0;
		min = 0;
		sec = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absClock(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		hour = _tuple$1[0];
		min = _tuple$1[1];
		sec = _tuple$1[2];
		$s = -1; return [hour, min, sec];
		return [hour, min, sec];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Clock }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.hour = hour; $f.min = min; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Clock = function() { return this.$val.Clock(); };
	absClock = function(abs) {
		var $ptr, _q, _q$1, abs, hour, min, sec;
		hour = 0;
		min = 0;
		sec = 0;
		sec = ($div64(abs, new $Uint64(0, 86400), true).$low >> 0);
		hour = (_q = sec / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(hour, 3600))) >> 0;
		min = (_q$1 = sec / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(min, 60))) >> 0;
		return [hour, min, sec];
	};
	Time.ptr.prototype.Hour = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Hour }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Hour = function() { return this.$val.Hour(); };
	Time.ptr.prototype.Minute = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Minute }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Minute = function() { return this.$val.Minute(); };
	Time.ptr.prototype.Second = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Second }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Second = function() { return this.$val.Second(); };
	Time.ptr.prototype.Nanosecond = function() {
		var $ptr, t;
		t = $clone(this, Time);
		return (t.nsec >> 0);
	};
	Time.prototype.Nanosecond = function() { return this.$val.Nanosecond(); };
	Time.ptr.prototype.YearDay = function() {
		var $ptr, _r$1, _tuple$1, t, yday, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; yday = $f.yday; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		yday = _tuple$1[3];
		$s = -1; return yday + 1 >> 0;
		return yday + 1 >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.YearDay }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.yday = yday; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.YearDay = function() { return this.$val.YearDay(); };
	Duration.prototype.String = function() {
		var $ptr, _tuple$1, _tuple$2, buf, d, neg, prec, u, w;
		d = this;
		buf = arrayType$4.zero();
		w = 32;
		u = new $Uint64(d.$high, d.$low);
		neg = (d.$high < 0 || (d.$high === 0 && d.$low < 0));
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000000))) {
			prec = 0;
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			w = w - (1) >> 0;
			if ((u.$high === 0 && u.$low === 0)) {
				return "0s";
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000))) {
				prec = 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 110);
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000))) {
				prec = 3;
				w = w - (1) >> 0;
				$copyString($subslice(new sliceType$3(buf), w), "\xC2\xB5");
			} else {
				prec = 6;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
			}
			_tuple$1 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, prec);
			w = _tuple$1[0];
			u = _tuple$1[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
		} else {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			_tuple$2 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, 9);
			w = _tuple$2[0];
			u = _tuple$2[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
			u = $div64(u, (new $Uint64(0, 60)), false);
			if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
				w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
				u = $div64(u, (new $Uint64(0, 60)), false);
				if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
					w = w - (1) >> 0;
					((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 104);
					w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
				}
			}
		}
		if (neg) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
		}
		return $bytesToString($subslice(new sliceType$3(buf), w));
	};
	$ptrType(Duration).prototype.String = function() { return this.$get().String(); };
	fmtFrac = function(buf, v, prec) {
		var $ptr, _tmp, _tmp$1, buf, digit, i, nv, nw, prec, print, v, w;
		nw = 0;
		nv = new $Uint64(0, 0);
		w = buf.$length;
		print = false;
		i = 0;
		while (true) {
			if (!(i < prec)) { break; }
			digit = $div64(v, new $Uint64(0, 10), true);
			print = print || !((digit.$high === 0 && digit.$low === 0));
			if (print) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = ((digit.$low << 24 >>> 24) + 48 << 24 >>> 24));
			}
			v = $div64(v, (new $Uint64(0, 10)), false);
			i = i + (1) >> 0;
		}
		if (print) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
		}
		_tmp = w;
		_tmp$1 = v;
		nw = _tmp;
		nv = _tmp$1;
		return [nw, nv];
	};
	fmtInt = function(buf, v) {
		var $ptr, buf, v, w;
		w = buf.$length;
		if ((v.$high === 0 && v.$low === 0)) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 48);
		} else {
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = (($div64(v, new $Uint64(0, 10), true).$low << 24 >>> 24) + 48 << 24 >>> 24));
				v = $div64(v, (new $Uint64(0, 10)), false);
			}
		}
		return w;
	};
	Duration.prototype.Nanoseconds = function() {
		var $ptr, d;
		d = this;
		return new $Int64(d.$high, d.$low);
	};
	$ptrType(Duration).prototype.Nanoseconds = function() { return this.$get().Nanoseconds(); };
	Duration.prototype.Seconds = function() {
		var $ptr, d, nsec, sec;
		d = this;
		sec = $div64(d, new Duration(0, 1000000000), false);
		nsec = $div64(d, new Duration(0, 1000000000), true);
		return $flatten64(sec) + $flatten64(nsec) * 1e-09;
	};
	$ptrType(Duration).prototype.Seconds = function() { return this.$get().Seconds(); };
	Duration.prototype.Minutes = function() {
		var $ptr, d, min, nsec;
		d = this;
		min = $div64(d, new Duration(13, 4165425152), false);
		nsec = $div64(d, new Duration(13, 4165425152), true);
		return $flatten64(min) + $flatten64(nsec) * 1.6666666666666667e-11;
	};
	$ptrType(Duration).prototype.Minutes = function() { return this.$get().Minutes(); };
	Duration.prototype.Hours = function() {
		var $ptr, d, hour, nsec;
		d = this;
		hour = $div64(d, new Duration(838, 817405952), false);
		nsec = $div64(d, new Duration(838, 817405952), true);
		return $flatten64(hour) + $flatten64(nsec) * 2.777777777777778e-13;
	};
	$ptrType(Duration).prototype.Hours = function() { return this.$get().Hours(); };
	Time.ptr.prototype.Add = function(d) {
		var $ptr, d, nsec, t, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		t = $clone(this, Time);
		t.sec = (x = t.sec, x$1 = (x$2 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$2.$high, x$2.$low)), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		nsec = t.nsec + ((x$3 = $div64(d, new Duration(0, 1000000000), true), x$3.$low + ((x$3.$high >> 31) * 4294967296)) >> 0) >> 0;
		if (nsec >= 1000000000) {
			t.sec = (x$4 = t.sec, x$5 = new $Int64(0, 1), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
			nsec = nsec - (1000000000) >> 0;
		} else if (nsec < 0) {
			t.sec = (x$6 = t.sec, x$7 = new $Int64(0, 1), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low));
			nsec = nsec + (1000000000) >> 0;
		}
		t.nsec = nsec;
		return t;
	};
	Time.prototype.Add = function(d) { return this.$val.Add(d); };
	Time.ptr.prototype.Sub = function(u) {
		var $ptr, d, t, u, x, x$1, x$2, x$3, x$4;
		u = $clone(u, Time);
		t = $clone(this, Time);
		d = (x = $mul64((x$1 = (x$2 = t.sec, x$3 = u.sec, new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low)), new Duration(x$1.$high, x$1.$low)), new Duration(0, 1000000000)), x$4 = new Duration(0, (t.nsec - u.nsec >> 0)), new Duration(x.$high + x$4.$high, x.$low + x$4.$low));
		if (u.Add(d).Equal(t)) {
			return d;
		} else if (t.Before(u)) {
			return new Duration(-2147483648, 0);
		} else {
			return new Duration(2147483647, 4294967295);
		}
	};
	Time.prototype.Sub = function(u) { return this.$val.Sub(u); };
	Time.ptr.prototype.AddDate = function(years, months$1, days$1) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, day, days$1, hour, min, month, months$1, sec, t, year, years, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; day = $f.day; days$1 = $f.days$1; hour = $f.hour; min = $f.min; month = $f.month; months$1 = $f.months$1; sec = $f.sec; t = $f.t; year = $f.year; years = $f.years; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Date(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		_r$2 = t.Clock(); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		hour = _tuple$2[0];
		min = _tuple$2[1];
		sec = _tuple$2[2];
		_r$3 = Date(year + years >> 0, month + (months$1 >> 0) >> 0, day + days$1 >> 0, hour, min, sec, (t.nsec >> 0), t.loc); /* */ $s = 3; case 3: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		$s = -1; return _r$3;
		return _r$3;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AddDate }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.day = day; $f.days$1 = days$1; $f.hour = hour; $f.min = min; $f.month = month; $f.months$1 = months$1; $f.sec = sec; $f.t = t; $f.year = year; $f.years = years; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AddDate = function(years, months$1, days$1) { return this.$val.AddDate(years, months$1, days$1); };
	Time.ptr.prototype.date = function(full) {
		var $ptr, _r$1, _r$2, _tuple$1, day, full, month, t, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; day = $f.day; full = $f.full; month = $f.month; t = $f.t; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absDate(_r$1, full); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		$s = -1; return [year, month, day, yday];
		return [year, month, day, yday];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.day = day; $f.full = full; $f.month = month; $f.t = t; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.date = function(full) { return this.$val.date(full); };
	absDate = function(abs, full) {
		var $ptr, _q, abs, begin, d, day, end, full, month, n, x, x$1, x$10, x$11, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, yday, year;
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		d = $div64(abs, new $Uint64(0, 86400), false);
		n = $div64(d, new $Uint64(0, 146097), false);
		y = $mul64(new $Uint64(0, 400), n);
		d = (x = $mul64(new $Uint64(0, 146097), n), new $Uint64(d.$high - x.$high, d.$low - x.$low));
		n = $div64(d, new $Uint64(0, 36524), false);
		n = (x$1 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$1.$high, n.$low - x$1.$low));
		y = (x$2 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high + x$2.$high, y.$low + x$2.$low));
		d = (x$3 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high - x$3.$high, d.$low - x$3.$low));
		n = $div64(d, new $Uint64(0, 1461), false);
		y = (x$4 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high + x$4.$high, y.$low + x$4.$low));
		d = (x$5 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high - x$5.$high, d.$low - x$5.$low));
		n = $div64(d, new $Uint64(0, 365), false);
		n = (x$6 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$6.$high, n.$low - x$6.$low));
		y = (x$7 = n, new $Uint64(y.$high + x$7.$high, y.$low + x$7.$low));
		d = (x$8 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high - x$8.$high, d.$low - x$8.$low));
		year = ((x$9 = (x$10 = new $Int64(y.$high, y.$low), new $Int64(x$10.$high + -69, x$10.$low + 4075721025)), x$9.$low + ((x$9.$high >> 31) * 4294967296)) >> 0);
		yday = (d.$low >> 0);
		if (!full) {
			return [year, month, day, yday];
		}
		day = yday;
		if (isLeap(year)) {
			if (day > 59) {
				day = day - (1) >> 0;
			} else if ((day === 59)) {
				month = 2;
				day = 29;
				return [year, month, day, yday];
			}
		}
		month = ((_q = day / 31, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
		end = ((x$11 = month + 1 >> 0, ((x$11 < 0 || x$11 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$11])) >> 0);
		begin = 0;
		if (day >= end) {
			month = month + (1) >> 0;
			begin = end;
		} else {
			begin = (((month < 0 || month >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[month]) >> 0);
		}
		month = month + (1) >> 0;
		day = (day - begin >> 0) + 1 >> 0;
		return [year, month, day, yday];
	};
	daysIn = function(m, year) {
		var $ptr, m, x, year;
		if ((m === 2) && isLeap(year)) {
			return 29;
		}
		return ((((m < 0 || m >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[m]) - (x = m - 1 >> 0, ((x < 0 || x >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x])) >> 0) >> 0);
	};
	Time.ptr.prototype.UTC = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.UTC;
		return t;
	};
	Time.prototype.UTC = function() { return this.$val.UTC(); };
	Time.ptr.prototype.Local = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.Local;
		return t;
	};
	Time.prototype.Local = function() { return this.$val.Local(); };
	Time.ptr.prototype.In = function(loc) {
		var $ptr, loc, t;
		t = $clone(this, Time);
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Time.In"));
		}
		t.loc = loc;
		return t;
	};
	Time.prototype.In = function(loc) { return this.$val.In(loc); };
	Time.ptr.prototype.Location = function() {
		var $ptr, l, t;
		t = $clone(this, Time);
		l = t.loc;
		if (l === ptrType$1.nil) {
			l = $pkg.UTC;
		}
		return l;
	};
	Time.prototype.Location = function() { return this.$val.Location(); };
	Time.ptr.prototype.Zone = function() {
		var $ptr, _r$1, _tuple$1, name, offset, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; name = $f.name; offset = $f.offset; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		t = $clone(this, Time);
		_r$1 = t.loc.lookup((x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640))); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		$s = -1; return [name, offset];
		return [name, offset];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Zone }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.name = name; $f.offset = offset; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Zone = function() { return this.$val.Zone(); };
	Time.ptr.prototype.Unix = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
	};
	Time.prototype.Unix = function() { return this.$val.Unix(); };
	Time.ptr.prototype.UnixNano = function() {
		var $ptr, t, x, x$1, x$2;
		t = $clone(this, Time);
		return (x = $mul64(((x$1 = t.sec, new $Int64(x$1.$high + -15, x$1.$low + 2288912640))), new $Int64(0, 1000000000)), x$2 = new $Int64(0, t.nsec), new $Int64(x.$high + x$2.$high, x.$low + x$2.$low));
	};
	Time.prototype.UnixNano = function() { return this.$val.UnixNano(); };
	Time.ptr.prototype.MarshalBinary = function() {
		var $ptr, _q, _r$1, _r$2, _tuple$1, enc, offset, offsetMin, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; enc = $f.enc; offset = $f.offset; offsetMin = $f.offsetMin; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		offsetMin = 0;
		/* */ if (t.Location() === utcLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (t.Location() === utcLoc) { */ case 1:
			offsetMin = -1;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = t.Zone(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			offset = _tuple$1[1];
			if (!(((_r$2 = offset % 60, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0))) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
			}
			offset = (_q = offset / (60), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			if (offset < -32768 || (offset === -1) || offset > 32767) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
			}
			offsetMin = (offset << 16 >> 16);
		/* } */ case 3:
		enc = new sliceType$3([1, ($shiftRightInt64(t.sec, 56).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 48).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 40).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 32).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 24).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 16).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 8).$low << 24 >>> 24), (t.sec.$low << 24 >>> 24), ((t.nsec >> 24 >> 0) << 24 >>> 24), ((t.nsec >> 16 >> 0) << 24 >>> 24), ((t.nsec >> 8 >> 0) << 24 >>> 24), (t.nsec << 24 >>> 24), ((offsetMin >> 8 << 16 >> 16) << 24 >>> 24), (offsetMin << 24 >>> 24)]);
		$s = -1; return [enc, $ifaceNil];
		return [enc, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalBinary }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.enc = enc; $f.offset = offset; $f.offsetMin = offsetMin; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalBinary = function() { return this.$val.MarshalBinary(); };
	Time.ptr.prototype.UnmarshalBinary = function(data$1) {
		var $ptr, _r$1, _tuple$1, buf, data$1, localoff, offset, t, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; buf = $f.buf; data$1 = $f.data$1; localoff = $f.localoff; offset = $f.offset; t = $f.t; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		buf = data$1;
		if (buf.$length === 0) {
			$s = -1; return errors.New("Time.UnmarshalBinary: no data");
			return errors.New("Time.UnmarshalBinary: no data");
		}
		if (!(((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) === 1))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: unsupported version");
			return errors.New("Time.UnmarshalBinary: unsupported version");
		}
		if (!((buf.$length === 15))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: invalid length");
			return errors.New("Time.UnmarshalBinary: invalid length");
		}
		buf = $subslice(buf, 1);
		t.sec = (x = (x$1 = (x$2 = (x$3 = (x$4 = (x$5 = (x$6 = new $Int64(0, (7 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 7])), x$7 = $shiftLeft64(new $Int64(0, (6 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 6])), 8), new $Int64(x$6.$high | x$7.$high, (x$6.$low | x$7.$low) >>> 0)), x$8 = $shiftLeft64(new $Int64(0, (5 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 5])), 16), new $Int64(x$5.$high | x$8.$high, (x$5.$low | x$8.$low) >>> 0)), x$9 = $shiftLeft64(new $Int64(0, (4 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 4])), 24), new $Int64(x$4.$high | x$9.$high, (x$4.$low | x$9.$low) >>> 0)), x$10 = $shiftLeft64(new $Int64(0, (3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3])), 32), new $Int64(x$3.$high | x$10.$high, (x$3.$low | x$10.$low) >>> 0)), x$11 = $shiftLeft64(new $Int64(0, (2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2])), 40), new $Int64(x$2.$high | x$11.$high, (x$2.$low | x$11.$low) >>> 0)), x$12 = $shiftLeft64(new $Int64(0, (1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1])), 48), new $Int64(x$1.$high | x$12.$high, (x$1.$low | x$12.$low) >>> 0)), x$13 = $shiftLeft64(new $Int64(0, (0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0])), 56), new $Int64(x.$high | x$13.$high, (x.$low | x$13.$low) >>> 0));
		buf = $subslice(buf, 8);
		t.nsec = ((((3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3]) >> 0) | (((2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2]) >> 0) << 8 >> 0)) | (((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) >> 0) << 16 >> 0)) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) >> 0) << 24 >> 0);
		buf = $subslice(buf, 4);
		offset = $imul(((((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) << 16 >> 16) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) << 16 >> 16) << 8 << 16 >> 16)) >> 0), 60);
		/* */ if (offset === -60) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (offset === -60) { */ case 1:
			t.loc = utcLoc;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = $pkg.Local.lookup((x$14 = t.sec, new $Int64(x$14.$high + -15, x$14.$low + 2288912640))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			localoff = _tuple$1[1];
			if (offset === localoff) {
				t.loc = $pkg.Local;
			} else {
				t.loc = FixedZone("", offset);
			}
		/* } */ case 3:
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalBinary }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.buf = buf; $f.data$1 = data$1; $f.localoff = localoff; $f.offset = offset; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalBinary = function(data$1) { return this.$val.UnmarshalBinary(data$1); };
	Time.ptr.prototype.GobEncode = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.MarshalBinary(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobEncode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobEncode = function() { return this.$val.GobEncode(); };
	Time.ptr.prototype.GobDecode = function(data$1) {
		var $ptr, _r$1, data$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; data$1 = $f.data$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r$1 = t.UnmarshalBinary(data$1); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobDecode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.data$1 = data$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobDecode = function(data$1) { return this.$val.GobDecode(data$1); };
	Time.ptr.prototype.MarshalJSON = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
			return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 37);
		b = $append(b, 34);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		b = _r$2;
		b = $append(b, 34);
		$s = -1; return [b, $ifaceNil];
		return [b, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalJSON = function() { return this.$val.MarshalJSON(); };
	Time.ptr.prototype.UnmarshalJSON = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		err = $ifaceNil;
		_r$1 = Parse("\"2006-01-02T15:04:05Z07:00\"", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		$s = -1; return err;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalJSON = function(data$1) { return this.$val.UnmarshalJSON(data$1); };
	Time.ptr.prototype.MarshalText = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
			return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 35);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return [_r$2, $ifaceNil];
		return [_r$2, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalText = function() { return this.$val.MarshalText(); };
	Time.ptr.prototype.UnmarshalText = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		err = $ifaceNil;
		_r$1 = Parse("2006-01-02T15:04:05Z07:00", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		$s = -1; return err;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalText = function(data$1) { return this.$val.UnmarshalText(data$1); };
	Unix = function(sec, nsec) {
		var $ptr, n, nsec, sec, x, x$1, x$2, x$3;
		if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0)) || (nsec.$high > 0 || (nsec.$high === 0 && nsec.$low >= 1000000000))) {
			n = $div64(nsec, new $Int64(0, 1000000000), false);
			sec = (x = n, new $Int64(sec.$high + x.$high, sec.$low + x.$low));
			nsec = (x$1 = $mul64(n, new $Int64(0, 1000000000)), new $Int64(nsec.$high - x$1.$high, nsec.$low - x$1.$low));
			if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0))) {
				nsec = (x$2 = new $Int64(0, 1000000000), new $Int64(nsec.$high + x$2.$high, nsec.$low + x$2.$low));
				sec = (x$3 = new $Int64(0, 1), new $Int64(sec.$high - x$3.$high, sec.$low - x$3.$low));
			}
		}
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), ((nsec.$low + ((nsec.$high >> 31) * 4294967296)) >> 0), $pkg.Local);
	};
	$pkg.Unix = Unix;
	isLeap = function(year) {
		var $ptr, _r$1, _r$2, _r$3, year;
		return ((_r$1 = year % 4, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0) && (!(((_r$2 = year % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0)) || ((_r$3 = year % 400, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero")) === 0));
	};
	norm = function(hi, lo, base) {
		var $ptr, _q, _q$1, _tmp, _tmp$1, base, hi, lo, n, n$1, nhi, nlo;
		nhi = 0;
		nlo = 0;
		if (lo < 0) {
			n = (_q = ((-lo - 1 >> 0)) / base, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) + 1 >> 0;
			hi = hi - (n) >> 0;
			lo = lo + (($imul(n, base))) >> 0;
		}
		if (lo >= base) {
			n$1 = (_q$1 = lo / base, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			hi = hi + (n$1) >> 0;
			lo = lo - (($imul(n$1, base))) >> 0;
		}
		_tmp = hi;
		_tmp$1 = lo;
		nhi = _tmp;
		nlo = _tmp$1;
		return [nhi, nlo];
	};
	Date = function(year, month, day, hour, min, sec, nsec, loc) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, abs, d, day, end, hour, loc, m, min, month, n, nsec, offset, sec, start, unix, utc, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; abs = $f.abs; d = $f.d; day = $f.day; end = $f.end; hour = $f.hour; loc = $f.loc; m = $f.m; min = $f.min; month = $f.month; n = $f.n; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; start = $f.start; unix = $f.unix; utc = $f.utc; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; y = $f.y; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Date"));
		}
		m = (month >> 0) - 1 >> 0;
		_tuple$1 = norm(year, m, 12);
		year = _tuple$1[0];
		m = _tuple$1[1];
		month = (m >> 0) + 1 >> 0;
		_tuple$2 = norm(sec, nsec, 1000000000);
		sec = _tuple$2[0];
		nsec = _tuple$2[1];
		_tuple$3 = norm(min, sec, 60);
		min = _tuple$3[0];
		sec = _tuple$3[1];
		_tuple$4 = norm(hour, min, 60);
		hour = _tuple$4[0];
		min = _tuple$4[1];
		_tuple$5 = norm(day, hour, 24);
		day = _tuple$5[0];
		hour = _tuple$5[1];
		y = (x = (x$1 = new $Int64(0, year), new $Int64(x$1.$high - -69, x$1.$low - 4075721025)), new $Uint64(x.$high, x.$low));
		n = $div64(y, new $Uint64(0, 400), false);
		y = (x$2 = $mul64(new $Uint64(0, 400), n), new $Uint64(y.$high - x$2.$high, y.$low - x$2.$low));
		d = $mul64(new $Uint64(0, 146097), n);
		n = $div64(y, new $Uint64(0, 100), false);
		y = (x$3 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high - x$3.$high, y.$low - x$3.$low));
		d = (x$4 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high + x$4.$high, d.$low + x$4.$low));
		n = $div64(y, new $Uint64(0, 4), false);
		y = (x$5 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high - x$5.$high, y.$low - x$5.$low));
		d = (x$6 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high + x$6.$high, d.$low + x$6.$low));
		n = y;
		d = (x$7 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high + x$7.$high, d.$low + x$7.$low));
		d = (x$8 = new $Uint64(0, (x$9 = month - 1 >> 0, ((x$9 < 0 || x$9 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$9]))), new $Uint64(d.$high + x$8.$high, d.$low + x$8.$low));
		if (isLeap(year) && month >= 3) {
			d = (x$10 = new $Uint64(0, 1), new $Uint64(d.$high + x$10.$high, d.$low + x$10.$low));
		}
		d = (x$11 = new $Uint64(0, (day - 1 >> 0)), new $Uint64(d.$high + x$11.$high, d.$low + x$11.$low));
		abs = $mul64(d, new $Uint64(0, 86400));
		abs = (x$12 = new $Uint64(0, ((($imul(hour, 3600)) + ($imul(min, 60)) >> 0) + sec >> 0)), new $Uint64(abs.$high + x$12.$high, abs.$low + x$12.$low));
		unix = (x$13 = new $Int64(abs.$high, abs.$low), new $Int64(x$13.$high + -2147483647, x$13.$low + 3844486912));
		_r$1 = loc.lookup(unix); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$6 = _r$1;
		offset = _tuple$6[1];
		start = _tuple$6[3];
		end = _tuple$6[4];
		/* */ if (!((offset === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((offset === 0))) { */ case 2:
				utc = (x$14 = new $Int64(0, offset), new $Int64(unix.$high - x$14.$high, unix.$low - x$14.$low));
				/* */ if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { $s = 5; continue; }
				/* */ if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { */ case 5:
					_r$2 = loc.lookup(new $Int64(start.$high - 0, start.$low - 1)); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$7 = _r$2;
					offset = _tuple$7[1];
					$s = 7; continue;
				/* } else if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { */ case 6:
					_r$3 = loc.lookup(end); /* */ $s = 9; case 9: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple$8 = _r$3;
					offset = _tuple$8[1];
				/* } */ case 7:
			case 4:
			unix = (x$15 = new $Int64(0, offset), new $Int64(unix.$high - x$15.$high, unix.$low - x$15.$low));
		/* } */ case 3:
		$s = -1; return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f.abs = abs; $f.d = d; $f.day = day; $f.end = end; $f.hour = hour; $f.loc = loc; $f.m = m; $f.min = min; $f.month = month; $f.n = n; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.start = start; $f.unix = unix; $f.utc = utc; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.y = y; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Date = Date;
	Time.ptr.prototype.Truncate = function(d) {
		var $ptr, _tuple$1, d, r, t;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		return t.Add(new Duration(-r.$high, -r.$low));
	};
	Time.prototype.Truncate = function(d) { return this.$val.Truncate(d); };
	Time.ptr.prototype.Round = function(d) {
		var $ptr, _tuple$1, d, r, t, x;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		if ((x = new Duration(r.$high + r.$high, r.$low + r.$low), (x.$high < d.$high || (x.$high === d.$high && x.$low < d.$low)))) {
			return t.Add(new Duration(-r.$high, -r.$low));
		}
		return t.Add(new Duration(d.$high - r.$high, d.$low - r.$low));
	};
	Time.prototype.Round = function(d) { return this.$val.Round(d); };
	div = function(t, d) {
		var $ptr, _q, _r$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, d, d0, d1, d1$1, neg, nsec, qmod2, r, sec, t, tmp, u0, u0x, u1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		qmod2 = 0;
		r = new Duration(0, 0);
		t = $clone(t, Time);
		neg = false;
		nsec = t.nsec;
		if ((x = t.sec, (x.$high < 0 || (x.$high === 0 && x.$low < 0)))) {
			neg = true;
			t.sec = (x$1 = t.sec, new $Int64(-x$1.$high, -x$1.$low));
			nsec = -nsec;
			if (nsec < 0) {
				nsec = nsec + (1000000000) >> 0;
				t.sec = (x$2 = t.sec, x$3 = new $Int64(0, 1), new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low));
			}
		}
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 1000000000)) && (x$4 = $div64(new Duration(0, 1000000000), (new Duration(d.$high + d.$high, d.$low + d.$low)), true), (x$4.$high === 0 && x$4.$low === 0))) {
			qmod2 = ((_q = nsec / ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0) & 1;
			r = new Duration(0, (_r$1 = nsec % ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")));
		} else if ((x$5 = $div64(d, new Duration(0, 1000000000), true), (x$5.$high === 0 && x$5.$low === 0))) {
			d1 = (x$6 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$6.$high, x$6.$low));
			qmod2 = ((x$7 = $div64(t.sec, d1, false), x$7.$low + ((x$7.$high >> 31) * 4294967296)) >> 0) & 1;
			r = (x$8 = $mul64((x$9 = $div64(t.sec, d1, true), new Duration(x$9.$high, x$9.$low)), new Duration(0, 1000000000)), x$10 = new Duration(0, nsec), new Duration(x$8.$high + x$10.$high, x$8.$low + x$10.$low));
		} else {
			sec = (x$11 = t.sec, new $Uint64(x$11.$high, x$11.$low));
			tmp = $mul64(($shiftRightUint64(sec, 32)), new $Uint64(0, 1000000000));
			u1 = $shiftRightUint64(tmp, 32);
			u0 = $shiftLeft64(tmp, 32);
			tmp = $mul64((new $Uint64(sec.$high & 0, (sec.$low & 4294967295) >>> 0)), new $Uint64(0, 1000000000));
			_tmp = u0;
			_tmp$1 = new $Uint64(u0.$high + tmp.$high, u0.$low + tmp.$low);
			u0x = _tmp;
			u0 = _tmp$1;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$12 = new $Uint64(0, 1), new $Uint64(u1.$high + x$12.$high, u1.$low + x$12.$low));
			}
			_tmp$2 = u0;
			_tmp$3 = (x$13 = new $Uint64(0, nsec), new $Uint64(u0.$high + x$13.$high, u0.$low + x$13.$low));
			u0x = _tmp$2;
			u0 = _tmp$3;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$14 = new $Uint64(0, 1), new $Uint64(u1.$high + x$14.$high, u1.$low + x$14.$low));
			}
			d1$1 = new $Uint64(d.$high, d.$low);
			while (true) {
				if (!(!((x$15 = $shiftRightUint64(d1$1, 63), (x$15.$high === 0 && x$15.$low === 1))))) { break; }
				d1$1 = $shiftLeft64(d1$1, (1));
			}
			d0 = new $Uint64(0, 0);
			while (true) {
				qmod2 = 0;
				if ((u1.$high > d1$1.$high || (u1.$high === d1$1.$high && u1.$low > d1$1.$low)) || (u1.$high === d1$1.$high && u1.$low === d1$1.$low) && (u0.$high > d0.$high || (u0.$high === d0.$high && u0.$low >= d0.$low))) {
					qmod2 = 1;
					_tmp$4 = u0;
					_tmp$5 = new $Uint64(u0.$high - d0.$high, u0.$low - d0.$low);
					u0x = _tmp$4;
					u0 = _tmp$5;
					if ((u0.$high > u0x.$high || (u0.$high === u0x.$high && u0.$low > u0x.$low))) {
						u1 = (x$16 = new $Uint64(0, 1), new $Uint64(u1.$high - x$16.$high, u1.$low - x$16.$low));
					}
					u1 = (x$17 = d1$1, new $Uint64(u1.$high - x$17.$high, u1.$low - x$17.$low));
				}
				if ((d1$1.$high === 0 && d1$1.$low === 0) && (x$18 = new $Uint64(d.$high, d.$low), (d0.$high === x$18.$high && d0.$low === x$18.$low))) {
					break;
				}
				d0 = $shiftRightUint64(d0, (1));
				d0 = (x$19 = $shiftLeft64((new $Uint64(d1$1.$high & 0, (d1$1.$low & 1) >>> 0)), 63), new $Uint64(d0.$high | x$19.$high, (d0.$low | x$19.$low) >>> 0));
				d1$1 = $shiftRightUint64(d1$1, (1));
			}
			r = new Duration(u0.$high, u0.$low);
		}
		if (neg && !((r.$high === 0 && r.$low === 0))) {
			qmod2 = (qmod2 ^ (1)) >> 0;
			r = new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		return [qmod2, r];
	};
	Location.ptr.prototype.get = function() {
		var $ptr, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		if (l === ptrType$1.nil) {
			$s = -1; return utcLoc;
			return utcLoc;
		}
		/* */ if (l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === localLoc) { */ case 1:
			$r = localOnce.Do(initLocal); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$s = -1; return l;
		return l;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.get }; } $f.$ptr = $ptr; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.get = function() { return this.$val.get(); };
	Location.ptr.prototype.String = function() {
		var $ptr, _r$1, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1.name;
		return _r$1.name;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.String = function() { return this.$val.String(); };
	FixedZone = function(name, offset) {
		var $ptr, l, name, offset, x;
		l = new Location.ptr(name, new sliceType([new zone.ptr(name, offset, false)]), new sliceType$1([new zoneTrans.ptr(new $Int64(-2147483648, 0), 0, false, false)]), new $Int64(-2147483648, 0), new $Int64(2147483647, 4294967295), ptrType.nil);
		l.cacheZone = (x = l.zone, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		return l;
	};
	$pkg.FixedZone = FixedZone;
	Location.ptr.prototype.lookup = function(sec) {
		var $ptr, _q, _r$1, end, hi, isDST, l, lim, lo, m, name, offset, sec, start, tx, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, zone$1, zone$2, zone$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; end = $f.end; hi = $f.hi; isDST = $f.isDST; l = $f.l; lim = $f.lim; lo = $f.lo; m = $f.m; name = $f.name; offset = $f.offset; sec = $f.sec; start = $f.start; tx = $f.tx; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; zone$1 = $f.zone$1; zone$2 = $f.zone$2; zone$3 = $f.zone$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		isDST = false;
		start = new $Int64(0, 0);
		end = new $Int64(0, 0);
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		if (l.zone.$length === 0) {
			name = "UTC";
			offset = 0;
			isDST = false;
			start = new $Int64(-2147483648, 0);
			end = new $Int64(2147483647, 4294967295);
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		zone$1 = l.cacheZone;
		if (!(zone$1 === ptrType.nil) && (x = l.cacheStart, (x.$high < sec.$high || (x.$high === sec.$high && x.$low <= sec.$low))) && (x$1 = l.cacheEnd, (sec.$high < x$1.$high || (sec.$high === x$1.$high && sec.$low < x$1.$low)))) {
			name = zone$1.name;
			offset = zone$1.offset;
			isDST = zone$1.isDST;
			start = l.cacheStart;
			end = l.cacheEnd;
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		if ((l.tx.$length === 0) || (x$2 = (x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).when, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) {
			zone$2 = (x$4 = l.zone, x$5 = l.lookupFirstZone(), ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5]));
			name = zone$2.name;
			offset = zone$2.offset;
			isDST = zone$2.isDST;
			start = new $Int64(-2147483648, 0);
			if (l.tx.$length > 0) {
				end = (x$6 = l.tx, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])).when;
			} else {
				end = new $Int64(2147483647, 4294967295);
			}
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		tx = l.tx;
		end = new $Int64(2147483647, 4294967295);
		lo = 0;
		hi = tx.$length;
		while (true) {
			if (!((hi - lo >> 0) > 1)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			lim = ((m < 0 || m >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + m]).when;
			if ((sec.$high < lim.$high || (sec.$high === lim.$high && sec.$low < lim.$low))) {
				end = lim;
				hi = m;
			} else {
				lo = m;
			}
		}
		zone$3 = (x$7 = l.zone, x$8 = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).index, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8]));
		name = zone$3.name;
		offset = zone$3.offset;
		isDST = zone$3.isDST;
		start = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).when;
		$s = -1; return [name, offset, isDST, start, end];
		return [name, offset, isDST, start, end];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookup }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.end = end; $f.hi = hi; $f.isDST = isDST; $f.l = l; $f.lim = lim; $f.lo = lo; $f.m = m; $f.name = name; $f.offset = offset; $f.sec = sec; $f.start = start; $f.tx = tx; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.zone$3 = zone$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookup = function(sec) { return this.$val.lookup(sec); };
	Location.ptr.prototype.lookupFirstZone = function() {
		var $ptr, _i, _ref, l, x, x$1, x$2, x$3, x$4, x$5, zi, zi$1;
		l = this;
		if (!l.firstZoneUsed()) {
			return 0;
		}
		if (l.tx.$length > 0 && (x = l.zone, x$1 = (x$2 = l.tx, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])).index, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).isDST) {
			zi = ((x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).index >> 0) - 1 >> 0;
			while (true) {
				if (!(zi >= 0)) { break; }
				if (!(x$4 = l.zone, ((zi < 0 || zi >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + zi])).isDST) {
					return zi;
				}
				zi = zi - (1) >> 0;
			}
		}
		_ref = l.zone;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			zi$1 = _i;
			if (!(x$5 = l.zone, ((zi$1 < 0 || zi$1 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + zi$1])).isDST) {
				return zi$1;
			}
			_i++;
		}
		return 0;
	};
	Location.prototype.lookupFirstZone = function() { return this.$val.lookupFirstZone(); };
	Location.ptr.prototype.firstZoneUsed = function() {
		var $ptr, _i, _ref, l, tx;
		l = this;
		_ref = l.tx;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			tx = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), zoneTrans);
			if (tx.index === 0) {
				return true;
			}
			_i++;
		}
		return false;
	};
	Location.prototype.firstZoneUsed = function() { return this.$val.firstZoneUsed(); };
	Location.ptr.prototype.lookupName = function(name, unix) {
		var $ptr, _i, _i$1, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple$1, i, i$1, isDST, isDST$1, l, nam, name, offset, offset$1, ok, unix, x, x$1, x$2, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple$1 = $f._tuple$1; i = $f.i; i$1 = $f.i$1; isDST = $f.isDST; isDST$1 = $f.isDST$1; l = $f.l; nam = $f.nam; name = $f.name; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; unix = $f.unix; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		offset = 0;
		isDST = false;
		ok = false;
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		_ref = l.zone;
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			zone$1 = (x = l.zone, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			/* */ if (zone$1.name === name) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (zone$1.name === name) { */ case 4:
				_r$2 = l.lookup((x$1 = new $Int64(0, zone$1.offset), new $Int64(unix.$high - x$1.$high, unix.$low - x$1.$low))); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				nam = _tuple$1[0];
				offset$1 = _tuple$1[1];
				isDST$1 = _tuple$1[2];
				if (nam === zone$1.name) {
					_tmp = offset$1;
					_tmp$1 = isDST$1;
					_tmp$2 = true;
					offset = _tmp;
					isDST = _tmp$1;
					ok = _tmp$2;
					$s = -1; return [offset, isDST, ok];
					return [offset, isDST, ok];
				}
			/* } */ case 5:
			_i++;
		/* } */ $s = 2; continue; case 3:
		_ref$1 = l.zone;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			zone$2 = (x$2 = l.zone, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			if (zone$2.name === name) {
				_tmp$3 = zone$2.offset;
				_tmp$4 = zone$2.isDST;
				_tmp$5 = true;
				offset = _tmp$3;
				isDST = _tmp$4;
				ok = _tmp$5;
				$s = -1; return [offset, isDST, ok];
				return [offset, isDST, ok];
			}
			_i$1++;
		}
		$s = -1; return [offset, isDST, ok];
		return [offset, isDST, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookupName }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple$1 = _tuple$1; $f.i = i; $f.i$1 = i$1; $f.isDST = isDST; $f.isDST$1 = isDST$1; $f.l = l; $f.nam = nam; $f.name = name; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.unix = unix; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookupName = function(name, unix) { return this.$val.lookupName(name, unix); };
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Time.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Format", name: "Format", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "AppendFormat", name: "AppendFormat", pkg: "", typ: $funcType([sliceType$3, $String], [sliceType$3], false)}, {prop: "After", name: "After", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Before", name: "Before", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Equal", name: "Equal", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "IsZero", name: "IsZero", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "abs", name: "abs", pkg: "time", typ: $funcType([], [$Uint64], false)}, {prop: "locabs", name: "locabs", pkg: "time", typ: $funcType([], [$String, $Int, $Uint64], false)}, {prop: "Date", name: "Date", pkg: "", typ: $funcType([], [$Int, Month, $Int], false)}, {prop: "Year", name: "Year", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Month", name: "Month", pkg: "", typ: $funcType([], [Month], false)}, {prop: "Day", name: "Day", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Weekday", name: "Weekday", pkg: "", typ: $funcType([], [Weekday], false)}, {prop: "ISOWeek", name: "ISOWeek", pkg: "", typ: $funcType([], [$Int, $Int], false)}, {prop: "Clock", name: "Clock", pkg: "", typ: $funcType([], [$Int, $Int, $Int], false)}, {prop: "Hour", name: "Hour", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Minute", name: "Minute", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Second", name: "Second", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Nanosecond", name: "Nanosecond", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "YearDay", name: "YearDay", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Time], [Duration], false)}, {prop: "AddDate", name: "AddDate", pkg: "", typ: $funcType([$Int, $Int, $Int], [Time], false)}, {prop: "date", name: "date", pkg: "time", typ: $funcType([$Bool], [$Int, Month, $Int, $Int], false)}, {prop: "UTC", name: "UTC", pkg: "", typ: $funcType([], [Time], false)}, {prop: "Local", name: "Local", pkg: "", typ: $funcType([], [Time], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([ptrType$1], [Time], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "Zone", name: "Zone", pkg: "", typ: $funcType([], [$String, $Int], false)}, {prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "UnixNano", name: "UnixNano", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "MarshalBinary", name: "MarshalBinary", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "GobEncode", name: "GobEncode", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Time], false)}];
	ptrType$6.methods = [{prop: "UnmarshalBinary", name: "UnmarshalBinary", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "GobDecode", name: "GobDecode", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType$3], [$error], false)}];
	Month.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Weekday.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Duration.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Nanoseconds", name: "Nanoseconds", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seconds", name: "Seconds", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Minutes", name: "Minutes", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Hours", name: "Hours", pkg: "", typ: $funcType([], [$Float64], false)}];
	ptrType$1.methods = [{prop: "get", name: "get", pkg: "time", typ: $funcType([], [ptrType$1], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "lookup", name: "lookup", pkg: "time", typ: $funcType([$Int64], [$String, $Int, $Bool, $Int64, $Int64], false)}, {prop: "lookupFirstZone", name: "lookupFirstZone", pkg: "time", typ: $funcType([], [$Int], false)}, {prop: "firstZoneUsed", name: "firstZoneUsed", pkg: "time", typ: $funcType([], [$Bool], false)}, {prop: "lookupName", name: "lookupName", pkg: "time", typ: $funcType([$String, $Int64], [$Int, $Bool, $Bool], false)}];
	ParseError.init("", [{prop: "Layout", name: "Layout", exported: true, typ: $String, tag: ""}, {prop: "Value", name: "Value", exported: true, typ: $String, tag: ""}, {prop: "LayoutElem", name: "LayoutElem", exported: true, typ: $String, tag: ""}, {prop: "ValueElem", name: "ValueElem", exported: true, typ: $String, tag: ""}, {prop: "Message", name: "Message", exported: true, typ: $String, tag: ""}]);
	Time.init("time", [{prop: "sec", name: "sec", exported: false, typ: $Int64, tag: ""}, {prop: "nsec", name: "nsec", exported: false, typ: $Int32, tag: ""}, {prop: "loc", name: "loc", exported: false, typ: ptrType$1, tag: ""}]);
	Location.init("time", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "zone", name: "zone", exported: false, typ: sliceType, tag: ""}, {prop: "tx", name: "tx", exported: false, typ: sliceType$1, tag: ""}, {prop: "cacheStart", name: "cacheStart", exported: false, typ: $Int64, tag: ""}, {prop: "cacheEnd", name: "cacheEnd", exported: false, typ: $Int64, tag: ""}, {prop: "cacheZone", name: "cacheZone", exported: false, typ: ptrType, tag: ""}]);
	zone.init("time", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "offset", name: "offset", exported: false, typ: $Int, tag: ""}, {prop: "isDST", name: "isDST", exported: false, typ: $Bool, tag: ""}]);
	zoneTrans.init("time", [{prop: "when", name: "when", exported: false, typ: $Int64, tag: ""}, {prop: "index", name: "index", exported: false, typ: $Uint8, tag: ""}, {prop: "isstd", name: "isstd", exported: false, typ: $Bool, tag: ""}, {prop: "isutc", name: "isutc", exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		localLoc = new Location.ptr("", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		localOnce = new nosync.Once.ptr(false, false);
		std0x = $toNativeArray($kindInt, [260, 265, 524, 526, 528, 274]);
		longDayNames = new sliceType$2(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		shortDayNames = new sliceType$2(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
		shortMonthNames = new sliceType$2(["---", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
		longMonthNames = new sliceType$2(["---", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		atoiError = errors.New("time: invalid number");
		errBad = errors.New("bad value for field");
		errLeadingInt = errors.New("time: bad [0-9]*");
		months = $toNativeArray($kindString, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		days = $toNativeArray($kindString, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		daysBefore = $toNativeArray($kindInt32, [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]);
		utcLoc = new Location.ptr("UTC", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		$pkg.UTC = utcLoc;
		$pkg.Local = localLoc;
		_r = syscall.Getenv("ZONEINFO"); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		zoneinfo = _tuple[0];
		badData = errors.New("malformed time zone information");
		zoneDirs = new sliceType$2(["/usr/share/zoneinfo/", "/usr/share/lib/zoneinfo/", "/usr/lib/locale/TZ/", runtime.GOROOT() + "/lib/time/zoneinfo.zip"]);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["os"] = (function() {
	var $pkg = {}, $init, errors, js, io, runtime, sync, atomic, syscall, time, PathError, SyscallError, LinkError, File, file, dirInfo, FileInfo, FileMode, fileStat, sliceType, ptrType, sliceType$1, ptrType$1, sliceType$2, ptrType$2, ptrType$3, ptrType$4, ptrType$12, funcType$1, ptrType$13, arrayType$1, arrayType$5, ptrType$15, errFinished, lstat, runtime_args, init, NewSyscallError, IsNotExist, isNotExist, fixCount, sigpipe, syscallMode, NewFile, epipecheck, Lstat, basename, init$1, fillFileStatFromSys, timespecToTime;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	atomic = $packages["sync/atomic"];
	syscall = $packages["syscall"];
	time = $packages["time"];
	PathError = $pkg.PathError = $newType(0, $kindStruct, "os.PathError", true, "os", true, function(Op_, Path_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = "";
			this.Path = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Op = Op_;
		this.Path = Path_;
		this.Err = Err_;
	});
	SyscallError = $pkg.SyscallError = $newType(0, $kindStruct, "os.SyscallError", true, "os", true, function(Syscall_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Syscall = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Syscall = Syscall_;
		this.Err = Err_;
	});
	LinkError = $pkg.LinkError = $newType(0, $kindStruct, "os.LinkError", true, "os", true, function(Op_, Old_, New_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = "";
			this.Old = "";
			this.New = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Op = Op_;
		this.Old = Old_;
		this.New = New_;
		this.Err = Err_;
	});
	File = $pkg.File = $newType(0, $kindStruct, "os.File", true, "os", true, function(file_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.file = ptrType$12.nil;
			return;
		}
		this.file = file_;
	});
	file = $pkg.file = $newType(0, $kindStruct, "os.file", true, "os", false, function(fd_, name_, dirinfo_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.fd = 0;
			this.name = "";
			this.dirinfo = ptrType.nil;
			return;
		}
		this.fd = fd_;
		this.name = name_;
		this.dirinfo = dirinfo_;
	});
	dirInfo = $pkg.dirInfo = $newType(0, $kindStruct, "os.dirInfo", true, "os", false, function(buf_, nbuf_, bufp_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType$1.nil;
			this.nbuf = 0;
			this.bufp = 0;
			return;
		}
		this.buf = buf_;
		this.nbuf = nbuf_;
		this.bufp = bufp_;
	});
	FileInfo = $pkg.FileInfo = $newType(8, $kindInterface, "os.FileInfo", true, "os", true, null);
	FileMode = $pkg.FileMode = $newType(4, $kindUint32, "os.FileMode", true, "os", true, null);
	fileStat = $pkg.fileStat = $newType(0, $kindStruct, "os.fileStat", true, "os", false, function(name_, size_, mode_, modTime_, sys_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.size = new $Int64(0, 0);
			this.mode = 0;
			this.modTime = new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil);
			this.sys = new syscall.Stat_t.ptr(new $Uint64(0, 0), new $Uint64(0, 0), new $Uint64(0, 0), 0, 0, 0, 0, new $Uint64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), arrayType$1.zero());
			return;
		}
		this.name = name_;
		this.size = size_;
		this.mode = mode_;
		this.modTime = modTime_;
		this.sys = sys_;
	});
	sliceType = $sliceType($String);
	ptrType = $ptrType(dirInfo);
	sliceType$1 = $sliceType($Uint8);
	ptrType$1 = $ptrType(File);
	sliceType$2 = $sliceType(FileInfo);
	ptrType$2 = $ptrType(PathError);
	ptrType$3 = $ptrType(LinkError);
	ptrType$4 = $ptrType(SyscallError);
	ptrType$12 = $ptrType(file);
	funcType$1 = $funcType([ptrType$12], [$error], false);
	ptrType$13 = $ptrType(time.Location);
	arrayType$1 = $arrayType($Int64, 3);
	arrayType$5 = $arrayType($Uint8, 32);
	ptrType$15 = $ptrType(fileStat);
	runtime_args = function() {
		var $ptr;
		return $pkg.Args;
	};
	init = function() {
		var $ptr, argv, i, process;
		process = $global.process;
		if (!(process === undefined)) {
			argv = process.argv;
			$pkg.Args = $makeSlice(sliceType, ($parseInt(argv.length) - 1 >> 0));
			i = 0;
			while (true) {
				if (!(i < ($parseInt(argv.length) - 1 >> 0))) { break; }
				((i < 0 || i >= $pkg.Args.$length) ? $throwRuntimeError("index out of range") : $pkg.Args.$array[$pkg.Args.$offset + i] = $internalize(argv[(i + 1 >> 0)], $String));
				i = i + (1) >> 0;
			}
		}
		if ($pkg.Args.$length === 0) {
			$pkg.Args = new sliceType(["?"]);
		}
	};
	File.ptr.prototype.readdirnames = function(n) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, _tuple$2, d, err, errno, f, n, names, nb, nc, size;
		names = sliceType.nil;
		err = $ifaceNil;
		f = this;
		if (f.file.dirinfo === ptrType.nil) {
			f.file.dirinfo = new dirInfo.ptr(sliceType$1.nil, 0, 0);
			f.file.dirinfo.buf = $makeSlice(sliceType$1, 4096);
		}
		d = f.file.dirinfo;
		size = n;
		if (size <= 0) {
			size = 100;
			n = -1;
		}
		names = $makeSlice(sliceType, 0, size);
		while (true) {
			if (!(!((n === 0)))) { break; }
			if (d.bufp >= d.nbuf) {
				d.bufp = 0;
				errno = $ifaceNil;
				_tuple$1 = syscall.ReadDirent(f.file.fd, d.buf);
				_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
				d.nbuf = _tuple[0];
				errno = _tuple[1];
				if (!($interfaceIsEqual(errno, $ifaceNil))) {
					_tmp = names;
					_tmp$1 = NewSyscallError("readdirent", errno);
					names = _tmp;
					err = _tmp$1;
					return [names, err];
				}
				if (d.nbuf <= 0) {
					break;
				}
			}
			_tmp$2 = 0;
			_tmp$3 = 0;
			nb = _tmp$2;
			nc = _tmp$3;
			_tuple$2 = syscall.ParseDirent($subslice(d.buf, d.bufp, d.nbuf), n, names);
			nb = _tuple$2[0];
			nc = _tuple$2[1];
			names = _tuple$2[2];
			d.bufp = d.bufp + (nb) >> 0;
			n = n - (nc) >> 0;
		}
		if (n >= 0 && (names.$length === 0)) {
			_tmp$4 = names;
			_tmp$5 = io.EOF;
			names = _tmp$4;
			err = _tmp$5;
			return [names, err];
		}
		_tmp$6 = names;
		_tmp$7 = $ifaceNil;
		names = _tmp$6;
		err = _tmp$7;
		return [names, err];
	};
	File.prototype.readdirnames = function(n) { return this.$val.readdirnames(n); };
	File.ptr.prototype.Readdir = function(n) {
		var $ptr, _r, f, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = this;
		if (f === ptrType$1.nil) {
			$s = -1; return [sliceType$2.nil, $pkg.ErrInvalid];
			return [sliceType$2.nil, $pkg.ErrInvalid];
		}
		_r = f.readdir(n); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: File.ptr.prototype.Readdir }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	File.prototype.Readdir = function(n) { return this.$val.Readdir(n); };
	File.ptr.prototype.Readdirnames = function(n) {
		var $ptr, _tmp, _tmp$1, _tuple, err, f, n, names;
		names = sliceType.nil;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = sliceType.nil;
			_tmp$1 = $pkg.ErrInvalid;
			names = _tmp;
			err = _tmp$1;
			return [names, err];
		}
		_tuple = f.readdirnames(n);
		names = _tuple[0];
		err = _tuple[1];
		return [names, err];
	};
	File.prototype.Readdirnames = function(n) { return this.$val.Readdirnames(n); };
	PathError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Op + " " + e.Path + ": " + _r;
		return e.Op + " " + e.Path + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: PathError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	PathError.prototype.Error = function() { return this.$val.Error(); };
	SyscallError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Syscall + ": " + _r;
		return e.Syscall + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: SyscallError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	SyscallError.prototype.Error = function() { return this.$val.Error(); };
	NewSyscallError = function(syscall$1, err) {
		var $ptr, err, syscall$1;
		if ($interfaceIsEqual(err, $ifaceNil)) {
			return $ifaceNil;
		}
		return new SyscallError.ptr(syscall$1, err);
	};
	$pkg.NewSyscallError = NewSyscallError;
	IsNotExist = function(err) {
		var $ptr, err;
		return isNotExist(err);
	};
	$pkg.IsNotExist = IsNotExist;
	isNotExist = function(err) {
		var $ptr, _ref, err, pe, pe$1, pe$2, pe$3;
		_ref = err;
		if (_ref === $ifaceNil) {
			pe = _ref;
			return false;
		} else if ($assertType(_ref, ptrType$2, true)[1]) {
			pe$1 = _ref.$val;
			err = pe$1.Err;
		} else if ($assertType(_ref, ptrType$3, true)[1]) {
			pe$2 = _ref.$val;
			err = pe$2.Err;
		} else if ($assertType(_ref, ptrType$4, true)[1]) {
			pe$3 = _ref.$val;
			err = pe$3.Err;
		}
		return $interfaceIsEqual(err, new syscall.Errno(2)) || $interfaceIsEqual(err, $pkg.ErrNotExist);
	};
	File.ptr.prototype.Name = function() {
		var $ptr, f;
		f = this;
		return f.file.name;
	};
	File.prototype.Name = function() { return this.$val.Name(); };
	LinkError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Op + " " + e.Old + " " + e.New + ": " + _r;
		return e.Op + " " + e.Old + " " + e.New + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: LinkError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	LinkError.prototype.Error = function() { return this.$val.Error(); };
	File.ptr.prototype.Read = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, b, e, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.read(b);
		n = _tuple[0];
		e = _tuple[1];
		if ((n === 0) && b.$length > 0 && $interfaceIsEqual(e, $ifaceNil)) {
			_tmp$2 = 0;
			_tmp$3 = io.EOF;
			n = _tmp$2;
			err = _tmp$3;
			return [n, err];
		}
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("read", f.file.name, e);
		}
		_tmp$4 = n;
		_tmp$5 = err;
		n = _tmp$4;
		err = _tmp$5;
		return [n, err];
	};
	File.prototype.Read = function(b) { return this.$val.Read(b); };
	File.ptr.prototype.ReadAt = function(b, off) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, f, m, n, off, x;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		while (true) {
			if (!(b.$length > 0)) { break; }
			_tuple = f.pread(b, off);
			m = _tuple[0];
			e = _tuple[1];
			if ((m === 0) && $interfaceIsEqual(e, $ifaceNil)) {
				_tmp$2 = n;
				_tmp$3 = io.EOF;
				n = _tmp$2;
				err = _tmp$3;
				return [n, err];
			}
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = new PathError.ptr("read", f.file.name, e);
				break;
			}
			n = n + (m) >> 0;
			b = $subslice(b, m);
			off = (x = new $Int64(0, m), new $Int64(off.$high + x.$high, off.$low + x.$low));
		}
		return [n, err];
	};
	File.prototype.ReadAt = function(b, off) { return this.$val.ReadAt(b, off); };
	File.ptr.prototype.Write = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.write(b);
		n = _tuple[0];
		e = _tuple[1];
		if (n < 0) {
			n = 0;
		}
		if (!((n === b.$length))) {
			err = io.ErrShortWrite;
		}
		epipecheck(f, e);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("write", f.file.name, e);
		}
		_tmp$2 = n;
		_tmp$3 = err;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
	};
	File.prototype.Write = function(b) { return this.$val.Write(b); };
	File.ptr.prototype.WriteAt = function(b, off) {
		var $ptr, _tmp, _tmp$1, _tuple, b, e, err, f, m, n, off, x;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		while (true) {
			if (!(b.$length > 0)) { break; }
			_tuple = f.pwrite(b, off);
			m = _tuple[0];
			e = _tuple[1];
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = new PathError.ptr("write", f.file.name, e);
				break;
			}
			n = n + (m) >> 0;
			b = $subslice(b, m);
			off = (x = new $Int64(0, m), new $Int64(off.$high + x.$high, off.$low + x.$low));
		}
		return [n, err];
	};
	File.prototype.WriteAt = function(b, off) { return this.$val.WriteAt(b, off); };
	File.ptr.prototype.Seek = function(offset, whence) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, e, err, f, offset, r, ret, whence;
		ret = new $Int64(0, 0);
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = new $Int64(0, 0);
			_tmp$1 = $pkg.ErrInvalid;
			ret = _tmp;
			err = _tmp$1;
			return [ret, err];
		}
		_tuple = f.seek(offset, whence);
		r = _tuple[0];
		e = _tuple[1];
		if ($interfaceIsEqual(e, $ifaceNil) && !(f.file.dirinfo === ptrType.nil) && !((r.$high === 0 && r.$low === 0))) {
			e = new syscall.Errno(21);
		}
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			_tmp$2 = new $Int64(0, 0);
			_tmp$3 = new PathError.ptr("seek", f.file.name, e);
			ret = _tmp$2;
			err = _tmp$3;
			return [ret, err];
		}
		_tmp$4 = r;
		_tmp$5 = $ifaceNil;
		ret = _tmp$4;
		err = _tmp$5;
		return [ret, err];
	};
	File.prototype.Seek = function(offset, whence) { return this.$val.Seek(offset, whence); };
	File.ptr.prototype.WriteString = function(s) {
		var $ptr, _tmp, _tmp$1, _tuple, err, f, n, s;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.Write(new sliceType$1($stringToBytes(s)));
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	File.ptr.prototype.Chdir = function() {
		var $ptr, e, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchdir(f.file.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chdir", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chdir = function() { return this.$val.Chdir(); };
	fixCount = function(n, err) {
		var $ptr, err, n;
		if (n < 0) {
			n = 0;
		}
		return [n, err];
	};
	sigpipe = function() {
		$throwRuntimeError("native function not implemented: os.sigpipe");
	};
	syscallMode = function(i) {
		var $ptr, i, o;
		o = 0;
		o = (o | ((new FileMode(i).Perm() >>> 0))) >>> 0;
		if (!((((i & 8388608) >>> 0) === 0))) {
			o = (o | (2048)) >>> 0;
		}
		if (!((((i & 4194304) >>> 0) === 0))) {
			o = (o | (1024)) >>> 0;
		}
		if (!((((i & 1048576) >>> 0) === 0))) {
			o = (o | (512)) >>> 0;
		}
		return o;
	};
	File.ptr.prototype.Chmod = function(mode) {
		var $ptr, e, f, mode;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchmod(f.file.fd, syscallMode(mode));
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chmod", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chmod = function(mode) { return this.$val.Chmod(mode); };
	File.ptr.prototype.Chown = function(uid, gid) {
		var $ptr, e, f, gid, uid;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchown(f.file.fd, uid, gid);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chown", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chown = function(uid, gid) { return this.$val.Chown(uid, gid); };
	File.ptr.prototype.Truncate = function(size) {
		var $ptr, e, f, size;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Ftruncate(f.file.fd, size);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("truncate", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Truncate = function(size) { return this.$val.Truncate(size); };
	File.ptr.prototype.Sync = function() {
		var $ptr, e, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fsync(f.file.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return NewSyscallError("fsync", e);
		}
		return $ifaceNil;
	};
	File.prototype.Sync = function() { return this.$val.Sync(); };
	File.ptr.prototype.Fd = function() {
		var $ptr, f;
		f = this;
		if (f === ptrType$1.nil) {
			return 4294967295;
		}
		return (f.file.fd >>> 0);
	};
	File.prototype.Fd = function() { return this.$val.Fd(); };
	NewFile = function(fd, name) {
		var $ptr, f, fd, fdi, name;
		fdi = (fd >> 0);
		if (fdi < 0) {
			return ptrType$1.nil;
		}
		f = new File.ptr(new file.ptr(fdi, name, ptrType.nil));
		runtime.SetFinalizer(f.file, new funcType$1($methodExpr(ptrType$12, "close")));
		return f;
	};
	$pkg.NewFile = NewFile;
	epipecheck = function(file$1, e) {
		var $ptr, e, file$1;
		if ($interfaceIsEqual(e, new syscall.Errno(32)) && ((file$1.file.fd === 1) || (file$1.file.fd === 2))) {
			sigpipe();
		}
	};
	File.ptr.prototype.Close = function() {
		var $ptr, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		return f.file.close();
	};
	File.prototype.Close = function() { return this.$val.Close(); };
	file.ptr.prototype.close = function() {
		var $ptr, e, err, file$1;
		file$1 = this;
		if (file$1 === ptrType$12.nil || file$1.fd < 0) {
			return new syscall.Errno(22);
		}
		err = $ifaceNil;
		e = syscall.Close(file$1.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("close", file$1.name, e);
		}
		file$1.fd = -1;
		runtime.SetFinalizer(file$1, $ifaceNil);
		return err;
	};
	file.prototype.close = function() { return this.$val.close(); };
	File.ptr.prototype.Stat = function() {
		var $ptr, err, f, fs;
		f = this;
		if (f === ptrType$1.nil) {
			return [$ifaceNil, $pkg.ErrInvalid];
		}
		fs = new fileStat.ptr("", new $Int64(0, 0), 0, new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil), new syscall.Stat_t.ptr(new $Uint64(0, 0), new $Uint64(0, 0), new $Uint64(0, 0), 0, 0, 0, 0, new $Uint64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), arrayType$1.zero()));
		err = syscall.Fstat(f.file.fd, fs.sys);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [$ifaceNil, new PathError.ptr("stat", f.file.name, err)];
		}
		fillFileStatFromSys(fs, f.file.name);
		return [fs, $ifaceNil];
	};
	File.prototype.Stat = function() { return this.$val.Stat(); };
	Lstat = function(name) {
		var $ptr, err, fs, name;
		fs = new fileStat.ptr("", new $Int64(0, 0), 0, new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil), new syscall.Stat_t.ptr(new $Uint64(0, 0), new $Uint64(0, 0), new $Uint64(0, 0), 0, 0, 0, 0, new $Uint64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new $Int64(0, 0), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), arrayType$1.zero()));
		err = syscall.Lstat(name, fs.sys);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [$ifaceNil, new PathError.ptr("lstat", name, err)];
		}
		fillFileStatFromSys(fs, name);
		return [fs, $ifaceNil];
	};
	$pkg.Lstat = Lstat;
	File.ptr.prototype.readdir = function(n) {
		var $ptr, _i, _r, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _tuple$1, dirname, err, f, fi, filename, fip, lerr, n, names, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; dirname = $f.dirname; err = $f.err; f = $f.f; fi = $f.fi; filename = $f.filename; fip = $f.fip; lerr = $f.lerr; n = $f.n; names = $f.names; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fi = sliceType$2.nil;
		err = $ifaceNil;
		f = this;
		dirname = f.file.name;
		if (dirname === "") {
			dirname = ".";
		}
		_tuple = f.Readdirnames(n);
		names = _tuple[0];
		err = _tuple[1];
		fi = $makeSlice(sliceType$2, 0, names.$length);
		_ref = names;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			filename = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_r = lstat(dirname + "/" + filename); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple$1 = _r;
			fip = _tuple$1[0];
			lerr = _tuple$1[1];
			if (IsNotExist(lerr)) {
				_i++;
				/* continue; */ $s = 1; continue;
			}
			if (!($interfaceIsEqual(lerr, $ifaceNil))) {
				_tmp = fi;
				_tmp$1 = lerr;
				fi = _tmp;
				err = _tmp$1;
				$s = -1; return [fi, err];
				return [fi, err];
			}
			fi = $append(fi, fip);
			_i++;
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = fi;
		_tmp$3 = err;
		fi = _tmp$2;
		err = _tmp$3;
		$s = -1; return [fi, err];
		return [fi, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: File.ptr.prototype.readdir }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.dirname = dirname; $f.err = err; $f.f = f; $f.fi = fi; $f.filename = filename; $f.fip = fip; $f.lerr = lerr; $f.n = n; $f.names = names; $f.$s = $s; $f.$r = $r; return $f;
	};
	File.prototype.readdir = function(n) { return this.$val.readdir(n); };
	File.ptr.prototype.read = function(b) {
		var $ptr, _tuple, _tuple$1, b, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (false && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Read(f.file.fd, b);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.read = function(b) { return this.$val.read(b); };
	File.ptr.prototype.pread = function(b, off) {
		var $ptr, _tuple, _tuple$1, b, err, f, n, off;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (false && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Pread(f.file.fd, b, off);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.pread = function(b, off) { return this.$val.pread(b, off); };
	File.ptr.prototype.write = function(b) {
		var $ptr, _tmp, _tmp$1, _tuple, _tuple$1, b, bcap, err, err$1, f, m, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		while (true) {
			bcap = b;
			if (false && bcap.$length > 1073741824) {
				bcap = $subslice(bcap, 0, 1073741824);
			}
			_tuple$1 = syscall.Write(f.file.fd, bcap);
			_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
			m = _tuple[0];
			err$1 = _tuple[1];
			n = n + (m) >> 0;
			if (0 < m && m < bcap.$length || $interfaceIsEqual(err$1, new syscall.Errno(4))) {
				b = $subslice(b, m);
				continue;
			}
			if (false && !((bcap.$length === b.$length)) && $interfaceIsEqual(err$1, $ifaceNil)) {
				b = $subslice(b, m);
				continue;
			}
			_tmp = n;
			_tmp$1 = err$1;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
	};
	File.prototype.write = function(b) { return this.$val.write(b); };
	File.ptr.prototype.pwrite = function(b, off) {
		var $ptr, _tuple, _tuple$1, b, err, f, n, off;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (false && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Pwrite(f.file.fd, b, off);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.pwrite = function(b, off) { return this.$val.pwrite(b, off); };
	File.ptr.prototype.seek = function(offset, whence) {
		var $ptr, _tuple, err, f, offset, ret, whence;
		ret = new $Int64(0, 0);
		err = $ifaceNil;
		f = this;
		_tuple = syscall.Seek(f.file.fd, offset, whence);
		ret = _tuple[0];
		err = _tuple[1];
		return [ret, err];
	};
	File.prototype.seek = function(offset, whence) { return this.$val.seek(offset, whence); };
	basename = function(name) {
		var $ptr, i, name;
		i = name.length - 1 >> 0;
		while (true) {
			if (!(i > 0 && (name.charCodeAt(i) === 47))) { break; }
			name = $substring(name, 0, i);
			i = i - (1) >> 0;
		}
		i = i - (1) >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			if (name.charCodeAt(i) === 47) {
				name = $substring(name, (i + 1 >> 0));
				break;
			}
			i = i - (1) >> 0;
		}
		return name;
	};
	init$1 = function() {
		var $ptr;
		if (false) {
			return;
		}
		$pkg.Args = runtime_args();
	};
	fillFileStatFromSys = function(fs, name) {
		var $ptr, _1, fs, name;
		fs.name = basename(name);
		fs.size = fs.sys.Size;
		time.Time.copy(fs.modTime, timespecToTime(fs.sys.Mtim));
		fs.mode = (((fs.sys.Mode & 511) >>> 0) >>> 0);
		_1 = (fs.sys.Mode & 61440) >>> 0;
		if (_1 === (24576)) {
			fs.mode = (fs.mode | (67108864)) >>> 0;
		} else if (_1 === (8192)) {
			fs.mode = (fs.mode | (69206016)) >>> 0;
		} else if (_1 === (16384)) {
			fs.mode = (fs.mode | (2147483648)) >>> 0;
		} else if (_1 === (4096)) {
			fs.mode = (fs.mode | (33554432)) >>> 0;
		} else if (_1 === (40960)) {
			fs.mode = (fs.mode | (134217728)) >>> 0;
		} else if (_1 === (32768)) {
		} else if (_1 === (49152)) {
			fs.mode = (fs.mode | (16777216)) >>> 0;
		}
		if (!((((fs.sys.Mode & 1024) >>> 0) === 0))) {
			fs.mode = (fs.mode | (4194304)) >>> 0;
		}
		if (!((((fs.sys.Mode & 2048) >>> 0) === 0))) {
			fs.mode = (fs.mode | (8388608)) >>> 0;
		}
		if (!((((fs.sys.Mode & 512) >>> 0) === 0))) {
			fs.mode = (fs.mode | (1048576)) >>> 0;
		}
	};
	timespecToTime = function(ts) {
		var $ptr, ts;
		ts = $clone(ts, syscall.Timespec);
		return time.Unix(ts.Sec, ts.Nsec);
	};
	FileMode.prototype.String = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, _rune, _rune$1, buf, c, c$1, i, i$1, m, w, y, y$1;
		m = this.$val;
		buf = arrayType$5.zero();
		w = 0;
		_ref = "dalTLDpSugct";
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			if (!((((m & (((y = ((31 - i >> 0) >>> 0), y < 32 ? (1 << y) : 0) >>> 0))) >>> 0) === 0))) {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = (c << 24 >>> 24));
				w = w + (1) >> 0;
			}
			_i += _rune[1];
		}
		if (w === 0) {
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
			w = w + (1) >> 0;
		}
		_ref$1 = "rwxrwxrwx";
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.length)) { break; }
			_rune$1 = $decodeRune(_ref$1, _i$1);
			i$1 = _i$1;
			c$1 = _rune$1[0];
			if (!((((m & (((y$1 = ((8 - i$1 >> 0) >>> 0), y$1 < 32 ? (1 << y$1) : 0) >>> 0))) >>> 0) === 0))) {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = (c$1 << 24 >>> 24));
			} else {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
			}
			w = w + (1) >> 0;
			_i$1 += _rune$1[1];
		}
		return $bytesToString($subslice(new sliceType$1(buf), 0, w));
	};
	$ptrType(FileMode).prototype.String = function() { return new FileMode(this.$get()).String(); };
	FileMode.prototype.IsDir = function() {
		var $ptr, m;
		m = this.$val;
		return !((((m & 2147483648) >>> 0) === 0));
	};
	$ptrType(FileMode).prototype.IsDir = function() { return new FileMode(this.$get()).IsDir(); };
	FileMode.prototype.IsRegular = function() {
		var $ptr, m;
		m = this.$val;
		return ((m & 2399141888) >>> 0) === 0;
	};
	$ptrType(FileMode).prototype.IsRegular = function() { return new FileMode(this.$get()).IsRegular(); };
	FileMode.prototype.Perm = function() {
		var $ptr, m;
		m = this.$val;
		return (m & 511) >>> 0;
	};
	$ptrType(FileMode).prototype.Perm = function() { return new FileMode(this.$get()).Perm(); };
	fileStat.ptr.prototype.Name = function() {
		var $ptr, fs;
		fs = this;
		return fs.name;
	};
	fileStat.prototype.Name = function() { return this.$val.Name(); };
	fileStat.ptr.prototype.IsDir = function() {
		var $ptr, fs;
		fs = this;
		return new FileMode(fs.Mode()).IsDir();
	};
	fileStat.prototype.IsDir = function() { return this.$val.IsDir(); };
	fileStat.ptr.prototype.Size = function() {
		var $ptr, fs;
		fs = this;
		return fs.size;
	};
	fileStat.prototype.Size = function() { return this.$val.Size(); };
	fileStat.ptr.prototype.Mode = function() {
		var $ptr, fs;
		fs = this;
		return fs.mode;
	};
	fileStat.prototype.Mode = function() { return this.$val.Mode(); };
	fileStat.ptr.prototype.ModTime = function() {
		var $ptr, fs;
		fs = this;
		return fs.modTime;
	};
	fileStat.prototype.ModTime = function() { return this.$val.ModTime(); };
	fileStat.ptr.prototype.Sys = function() {
		var $ptr, fs;
		fs = this;
		return fs.sys;
	};
	fileStat.prototype.Sys = function() { return this.$val.Sys(); };
	ptrType$2.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "readdirnames", name: "readdirnames", pkg: "os", typ: $funcType([$Int], [sliceType, $error], false)}, {prop: "Readdir", name: "Readdir", pkg: "", typ: $funcType([$Int], [sliceType$2, $error], false)}, {prop: "Readdirnames", name: "Readdirnames", pkg: "", typ: $funcType([$Int], [sliceType, $error], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "ReadAt", name: "ReadAt", pkg: "", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "WriteAt", name: "WriteAt", pkg: "", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "Seek", name: "Seek", pkg: "", typ: $funcType([$Int64, $Int], [$Int64, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}, {prop: "Chdir", name: "Chdir", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Chmod", name: "Chmod", pkg: "", typ: $funcType([FileMode], [$error], false)}, {prop: "Chown", name: "Chown", pkg: "", typ: $funcType([$Int, $Int], [$error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([$Int64], [$error], false)}, {prop: "Sync", name: "Sync", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Fd", name: "Fd", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Stat", name: "Stat", pkg: "", typ: $funcType([], [FileInfo, $error], false)}, {prop: "readdir", name: "readdir", pkg: "os", typ: $funcType([$Int], [sliceType$2, $error], false)}, {prop: "read", name: "read", pkg: "os", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "pread", name: "pread", pkg: "os", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "write", name: "write", pkg: "os", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "pwrite", name: "pwrite", pkg: "os", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "seek", name: "seek", pkg: "os", typ: $funcType([$Int64, $Int], [$Int64, $error], false)}];
	ptrType$12.methods = [{prop: "close", name: "close", pkg: "os", typ: $funcType([], [$error], false)}];
	FileMode.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "IsRegular", name: "IsRegular", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Perm", name: "Perm", pkg: "", typ: $funcType([], [FileMode], false)}];
	ptrType$15.methods = [{prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Mode", name: "Mode", pkg: "", typ: $funcType([], [FileMode], false)}, {prop: "ModTime", name: "ModTime", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Sys", name: "Sys", pkg: "", typ: $funcType([], [$emptyInterface], false)}];
	PathError.init("", [{prop: "Op", name: "Op", exported: true, typ: $String, tag: ""}, {prop: "Path", name: "Path", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	SyscallError.init("", [{prop: "Syscall", name: "Syscall", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	LinkError.init("", [{prop: "Op", name: "Op", exported: true, typ: $String, tag: ""}, {prop: "Old", name: "Old", exported: true, typ: $String, tag: ""}, {prop: "New", name: "New", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	File.init("os", [{prop: "file", name: "", exported: false, typ: ptrType$12, tag: ""}]);
	file.init("os", [{prop: "fd", name: "fd", exported: false, typ: $Int, tag: ""}, {prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "dirinfo", name: "dirinfo", exported: false, typ: ptrType, tag: ""}]);
	dirInfo.init("os", [{prop: "buf", name: "buf", exported: false, typ: sliceType$1, tag: ""}, {prop: "nbuf", name: "nbuf", exported: false, typ: $Int, tag: ""}, {prop: "bufp", name: "bufp", exported: false, typ: $Int, tag: ""}]);
	FileInfo.init([{prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ModTime", name: "ModTime", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Mode", name: "Mode", pkg: "", typ: $funcType([], [FileMode], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Sys", name: "Sys", pkg: "", typ: $funcType([], [$emptyInterface], false)}]);
	fileStat.init("os", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "size", name: "size", exported: false, typ: $Int64, tag: ""}, {prop: "mode", name: "mode", exported: false, typ: FileMode, tag: ""}, {prop: "modTime", name: "modTime", exported: false, typ: time.Time, tag: ""}, {prop: "sys", name: "sys", exported: false, typ: syscall.Stat_t, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.Args = sliceType.nil;
		$pkg.ErrInvalid = errors.New("invalid argument");
		$pkg.ErrPermission = errors.New("permission denied");
		$pkg.ErrExist = errors.New("file already exists");
		$pkg.ErrNotExist = errors.New("file does not exist");
		errFinished = errors.New("os: process already finished");
		$pkg.Stdin = NewFile((syscall.Stdin >>> 0), "/dev/stdin");
		$pkg.Stdout = NewFile((syscall.Stdout >>> 0), "/dev/stdout");
		$pkg.Stderr = NewFile((syscall.Stderr >>> 0), "/dev/stderr");
		lstat = Lstat;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, decimal, leftCheat, extFloat, floatInfo, decimalSlice, sliceType$3, sliceType$4, sliceType$5, arrayType, sliceType$6, arrayType$1, arrayType$2, ptrType$1, arrayType$3, arrayType$4, ptrType$2, ptrType$3, ptrType$4, optimize, leftcheats, smallPowersOfTen, powersOfTen, uint64pow10, float32info, float32info$24ptr, float64info, float64info$24ptr, isPrint16, isNotPrint16, isPrint32, isNotPrint32, isGraphic, shifts, digitZero, trim, rightShift, prefixIsLessThan, leftShift, shouldRoundUp, frexp10Many, adjustLastDigitFixed, adjustLastDigit, AppendFloat, genericFtoa, bigFtoa, formatDigits, roundShortest, fmtE, fmtF, fmtB, min, max, FormatInt, Itoa, formatBits, appendQuotedWith, appendQuotedRuneWith, appendEscapedRune, AppendQuote, AppendQuoteToASCII, AppendQuoteRune, AppendQuoteRuneToASCII, CanBackquote, unhex, UnquoteChar, Unquote, contains, bsearch16, bsearch32, IsPrint, isInGraphicList;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	decimal = $pkg.decimal = $newType(0, $kindStruct, "strconv.decimal", true, "strconv", false, function(d_, nd_, dp_, neg_, trunc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.d = arrayType.zero();
			this.nd = 0;
			this.dp = 0;
			this.neg = false;
			this.trunc = false;
			return;
		}
		this.d = d_;
		this.nd = nd_;
		this.dp = dp_;
		this.neg = neg_;
		this.trunc = trunc_;
	});
	leftCheat = $pkg.leftCheat = $newType(0, $kindStruct, "strconv.leftCheat", true, "strconv", false, function(delta_, cutoff_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.delta = 0;
			this.cutoff = "";
			return;
		}
		this.delta = delta_;
		this.cutoff = cutoff_;
	});
	extFloat = $pkg.extFloat = $newType(0, $kindStruct, "strconv.extFloat", true, "strconv", false, function(mant_, exp_, neg_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.mant = new $Uint64(0, 0);
			this.exp = 0;
			this.neg = false;
			return;
		}
		this.mant = mant_;
		this.exp = exp_;
		this.neg = neg_;
	});
	floatInfo = $pkg.floatInfo = $newType(0, $kindStruct, "strconv.floatInfo", true, "strconv", false, function(mantbits_, expbits_, bias_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.mantbits = 0;
			this.expbits = 0;
			this.bias = 0;
			return;
		}
		this.mantbits = mantbits_;
		this.expbits = expbits_;
		this.bias = bias_;
	});
	decimalSlice = $pkg.decimalSlice = $newType(0, $kindStruct, "strconv.decimalSlice", true, "strconv", false, function(d_, nd_, dp_, neg_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.d = sliceType$6.nil;
			this.nd = 0;
			this.dp = 0;
			this.neg = false;
			return;
		}
		this.d = d_;
		this.nd = nd_;
		this.dp = dp_;
		this.neg = neg_;
	});
	sliceType$3 = $sliceType(leftCheat);
	sliceType$4 = $sliceType($Uint16);
	sliceType$5 = $sliceType($Uint32);
	arrayType = $arrayType($Uint8, 800);
	sliceType$6 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 24);
	arrayType$2 = $arrayType($Uint8, 32);
	ptrType$1 = $ptrType(floatInfo);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	ptrType$2 = $ptrType(decimal);
	ptrType$3 = $ptrType(decimalSlice);
	ptrType$4 = $ptrType(extFloat);
	decimal.ptr.prototype.String = function() {
		var $ptr, a, buf, n, w;
		a = this;
		n = 10 + a.nd >> 0;
		if (a.dp > 0) {
			n = n + (a.dp) >> 0;
		}
		if (a.dp < 0) {
			n = n + (-a.dp) >> 0;
		}
		buf = $makeSlice(sliceType$6, n);
		w = 0;
		if ((a.nd === 0)) {
			return "0";
		} else if (a.dp <= 0) {
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 48);
			w = w + (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
			w = w + (1) >> 0;
			w = w + (digitZero($subslice(buf, w, (w + -a.dp >> 0)))) >> 0;
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.nd))) >> 0;
		} else if (a.dp < a.nd) {
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.dp))) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
			w = w + (1) >> 0;
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), a.dp, a.nd))) >> 0;
		} else {
			w = w + ($copySlice($subslice(buf, w), $subslice(new sliceType$6(a.d), 0, a.nd))) >> 0;
			w = w + (digitZero($subslice(buf, w, ((w + a.dp >> 0) - a.nd >> 0)))) >> 0;
		}
		return $bytesToString($subslice(buf, 0, w));
	};
	decimal.prototype.String = function() { return this.$val.String(); };
	digitZero = function(dst) {
		var $ptr, _i, _ref, dst, i;
		_ref = dst;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= dst.$length) ? $throwRuntimeError("index out of range") : dst.$array[dst.$offset + i] = 48);
			_i++;
		}
		return dst.$length;
	};
	trim = function(a) {
		var $ptr, a, x, x$1;
		while (true) {
			if (!(a.nd > 0 && ((x = a.d, x$1 = a.nd - 1 >> 0, ((x$1 < 0 || x$1 >= x.length) ? $throwRuntimeError("index out of range") : x[x$1])) === 48))) { break; }
			a.nd = a.nd - (1) >> 0;
		}
		if (a.nd === 0) {
			a.dp = 0;
		}
	};
	decimal.ptr.prototype.Assign = function(v) {
		var $ptr, a, buf, n, v, v1, x, x$1, x$2;
		a = this;
		buf = arrayType$1.zero();
		n = 0;
		while (true) {
			if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
			v1 = $div64(v, new $Uint64(0, 10), false);
			v = (x = $mul64(new $Uint64(0, 10), v1), new $Uint64(v.$high - x.$high, v.$low - x.$low));
			((n < 0 || n >= buf.length) ? $throwRuntimeError("index out of range") : buf[n] = (new $Uint64(v.$high + 0, v.$low + 48).$low << 24 >>> 24));
			n = n + (1) >> 0;
			v = v1;
		}
		a.nd = 0;
		n = n - (1) >> 0;
		while (true) {
			if (!(n >= 0)) { break; }
			(x$1 = a.d, x$2 = a.nd, ((x$2 < 0 || x$2 >= x$1.length) ? $throwRuntimeError("index out of range") : x$1[x$2] = ((n < 0 || n >= buf.length) ? $throwRuntimeError("index out of range") : buf[n])));
			a.nd = a.nd + (1) >> 0;
			n = n - (1) >> 0;
		}
		a.dp = a.nd;
		trim(a);
	};
	decimal.prototype.Assign = function(v) { return this.$val.Assign(v); };
	rightShift = function(a, k) {
		var $ptr, a, c, c$1, dig, dig$1, k, n, r, w, x, x$1, x$2, x$3, y, y$1, y$2, y$3, y$4, y$5;
		r = 0;
		w = 0;
		n = 0;
		while (true) {
			if (!(((y = k, y < 32 ? (n >>> y) : 0) >>> 0) === 0)) { break; }
			if (r >= a.nd) {
				if (n === 0) {
					a.nd = 0;
					return;
				}
				while (true) {
					if (!(((y$1 = k, y$1 < 32 ? (n >>> y$1) : 0) >>> 0) === 0)) { break; }
					n = n * 10 >>> 0;
					r = r + (1) >> 0;
				}
				break;
			}
			c = ((x = a.d, ((r < 0 || r >= x.length) ? $throwRuntimeError("index out of range") : x[r])) >>> 0);
			n = ((n * 10 >>> 0) + c >>> 0) - 48 >>> 0;
			r = r + (1) >> 0;
		}
		a.dp = a.dp - ((r - 1 >> 0)) >> 0;
		while (true) {
			if (!(r < a.nd)) { break; }
			c$1 = ((x$1 = a.d, ((r < 0 || r >= x$1.length) ? $throwRuntimeError("index out of range") : x$1[r])) >>> 0);
			dig = (y$2 = k, y$2 < 32 ? (n >>> y$2) : 0) >>> 0;
			n = n - (((y$3 = k, y$3 < 32 ? (dig << y$3) : 0) >>> 0)) >>> 0;
			(x$2 = a.d, ((w < 0 || w >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[w] = ((dig + 48 >>> 0) << 24 >>> 24)));
			w = w + (1) >> 0;
			n = ((n * 10 >>> 0) + c$1 >>> 0) - 48 >>> 0;
			r = r + (1) >> 0;
		}
		while (true) {
			if (!(n > 0)) { break; }
			dig$1 = (y$4 = k, y$4 < 32 ? (n >>> y$4) : 0) >>> 0;
			n = n - (((y$5 = k, y$5 < 32 ? (dig$1 << y$5) : 0) >>> 0)) >>> 0;
			if (w < 800) {
				(x$3 = a.d, ((w < 0 || w >= x$3.length) ? $throwRuntimeError("index out of range") : x$3[w] = ((dig$1 + 48 >>> 0) << 24 >>> 24)));
				w = w + (1) >> 0;
			} else if (dig$1 > 0) {
				a.trunc = true;
			}
			n = n * 10 >>> 0;
		}
		a.nd = w;
		trim(a);
	};
	prefixIsLessThan = function(b, s) {
		var $ptr, b, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (i >= b.$length) {
				return true;
			}
			if (!((((i < 0 || i >= b.$length) ? $throwRuntimeError("index out of range") : b.$array[b.$offset + i]) === s.charCodeAt(i)))) {
				return ((i < 0 || i >= b.$length) ? $throwRuntimeError("index out of range") : b.$array[b.$offset + i]) < s.charCodeAt(i);
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	leftShift = function(a, k) {
		var $ptr, _q, _q$1, a, delta, k, n, quo, quo$1, r, rem, rem$1, w, x, x$1, x$2, y;
		delta = ((k < 0 || k >= leftcheats.$length) ? $throwRuntimeError("index out of range") : leftcheats.$array[leftcheats.$offset + k]).delta;
		if (prefixIsLessThan($subslice(new sliceType$6(a.d), 0, a.nd), ((k < 0 || k >= leftcheats.$length) ? $throwRuntimeError("index out of range") : leftcheats.$array[leftcheats.$offset + k]).cutoff)) {
			delta = delta - (1) >> 0;
		}
		r = a.nd;
		w = a.nd + delta >> 0;
		n = 0;
		r = r - (1) >> 0;
		while (true) {
			if (!(r >= 0)) { break; }
			n = n + (((y = k, y < 32 ? (((((x = a.d, ((r < 0 || r >= x.length) ? $throwRuntimeError("index out of range") : x[r])) >>> 0) - 48 >>> 0)) << y) : 0) >>> 0)) >>> 0;
			quo = (_q = n / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			rem = n - (10 * quo >>> 0) >>> 0;
			w = w - (1) >> 0;
			if (w < 800) {
				(x$1 = a.d, ((w < 0 || w >= x$1.length) ? $throwRuntimeError("index out of range") : x$1[w] = ((rem + 48 >>> 0) << 24 >>> 24)));
			} else if (!((rem === 0))) {
				a.trunc = true;
			}
			n = quo;
			r = r - (1) >> 0;
		}
		while (true) {
			if (!(n > 0)) { break; }
			quo$1 = (_q$1 = n / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
			rem$1 = n - (10 * quo$1 >>> 0) >>> 0;
			w = w - (1) >> 0;
			if (w < 800) {
				(x$2 = a.d, ((w < 0 || w >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[w] = ((rem$1 + 48 >>> 0) << 24 >>> 24)));
			} else if (!((rem$1 === 0))) {
				a.trunc = true;
			}
			n = quo$1;
		}
		a.nd = a.nd + (delta) >> 0;
		if (a.nd >= 800) {
			a.nd = 800;
		}
		a.dp = a.dp + (delta) >> 0;
		trim(a);
	};
	decimal.ptr.prototype.Shift = function(k) {
		var $ptr, a, k;
		a = this;
		if ((a.nd === 0)) {
		} else if (k > 0) {
			while (true) {
				if (!(k > 28)) { break; }
				leftShift(a, 28);
				k = k - (28) >> 0;
			}
			leftShift(a, (k >>> 0));
		} else if (k < 0) {
			while (true) {
				if (!(k < -28)) { break; }
				rightShift(a, 28);
				k = k + (28) >> 0;
			}
			rightShift(a, (-k >>> 0));
		}
	};
	decimal.prototype.Shift = function(k) { return this.$val.Shift(k); };
	shouldRoundUp = function(a, nd) {
		var $ptr, _r, a, nd, x, x$1, x$2, x$3;
		if (nd < 0 || nd >= a.nd) {
			return false;
		}
		if (((x = a.d, ((nd < 0 || nd >= x.length) ? $throwRuntimeError("index out of range") : x[nd])) === 53) && ((nd + 1 >> 0) === a.nd)) {
			if (a.trunc) {
				return true;
			}
			return nd > 0 && !(((_r = (((x$1 = a.d, x$2 = nd - 1 >> 0, ((x$2 < 0 || x$2 >= x$1.length) ? $throwRuntimeError("index out of range") : x$1[x$2])) - 48 << 24 >>> 24)) % 2, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0));
		}
		return (x$3 = a.d, ((nd < 0 || nd >= x$3.length) ? $throwRuntimeError("index out of range") : x$3[nd])) >= 53;
	};
	decimal.ptr.prototype.Round = function(nd) {
		var $ptr, a, nd;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		if (shouldRoundUp(a, nd)) {
			a.RoundUp(nd);
		} else {
			a.RoundDown(nd);
		}
	};
	decimal.prototype.Round = function(nd) { return this.$val.Round(nd); };
	decimal.ptr.prototype.RoundDown = function(nd) {
		var $ptr, a, nd;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		a.nd = nd;
		trim(a);
	};
	decimal.prototype.RoundDown = function(nd) { return this.$val.RoundDown(nd); };
	decimal.ptr.prototype.RoundUp = function(nd) {
		var $ptr, a, c, i, nd, x, x$1, x$2;
		a = this;
		if (nd < 0 || nd >= a.nd) {
			return;
		}
		i = nd - 1 >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			c = (x = a.d, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i]));
			if (c < 57) {
				(x$2 = a.d, ((i < 0 || i >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[i] = ((x$1 = a.d, ((i < 0 || i >= x$1.length) ? $throwRuntimeError("index out of range") : x$1[i])) + (1) << 24 >>> 24)));
				a.nd = i + 1 >> 0;
				return;
			}
			i = i - (1) >> 0;
		}
		a.d[0] = 49;
		a.nd = 1;
		a.dp = a.dp + (1) >> 0;
	};
	decimal.prototype.RoundUp = function(nd) { return this.$val.RoundUp(nd); };
	decimal.ptr.prototype.RoundedInteger = function() {
		var $ptr, a, i, n, x, x$1, x$2, x$3;
		a = this;
		if (a.dp > 20) {
			return new $Uint64(4294967295, 4294967295);
		}
		i = 0;
		n = new $Uint64(0, 0);
		i = 0;
		while (true) {
			if (!(i < a.dp && i < a.nd)) { break; }
			n = (x = $mul64(n, new $Uint64(0, 10)), x$1 = new $Uint64(0, ((x$2 = a.d, ((i < 0 || i >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[i])) - 48 << 24 >>> 24)), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
			i = i + (1) >> 0;
		}
		while (true) {
			if (!(i < a.dp)) { break; }
			n = $mul64(n, (new $Uint64(0, 10)));
			i = i + (1) >> 0;
		}
		if (shouldRoundUp(a, a.dp)) {
			n = (x$3 = new $Uint64(0, 1), new $Uint64(n.$high + x$3.$high, n.$low + x$3.$low));
		}
		return n;
	};
	decimal.prototype.RoundedInteger = function() { return this.$val.RoundedInteger(); };
	extFloat.ptr.prototype.AssignComputeBounds = function(mant, exp, neg, flt) {
		var $ptr, _tmp, _tmp$1, exp, expBiased, f, flt, lower, mant, neg, upper, x, x$1, x$2, x$3, x$4;
		lower = new extFloat.ptr(new $Uint64(0, 0), 0, false);
		upper = new extFloat.ptr(new $Uint64(0, 0), 0, false);
		f = this;
		f.mant = mant;
		f.exp = exp - (flt.mantbits >> 0) >> 0;
		f.neg = neg;
		if (f.exp <= 0 && (x = $shiftLeft64(($shiftRightUint64(mant, (-f.exp >>> 0))), (-f.exp >>> 0)), (mant.$high === x.$high && mant.$low === x.$low))) {
			f.mant = $shiftRightUint64(f.mant, ((-f.exp >>> 0)));
			f.exp = 0;
			_tmp = $clone(f, extFloat);
			_tmp$1 = $clone(f, extFloat);
			extFloat.copy(lower, _tmp);
			extFloat.copy(upper, _tmp$1);
			return [lower, upper];
		}
		expBiased = exp - flt.bias >> 0;
		extFloat.copy(upper, new extFloat.ptr((x$1 = $mul64(new $Uint64(0, 2), f.mant), new $Uint64(x$1.$high + 0, x$1.$low + 1)), f.exp - 1 >> 0, f.neg));
		if (!((x$2 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), (mant.$high === x$2.$high && mant.$low === x$2.$low))) || (expBiased === 1)) {
			extFloat.copy(lower, new extFloat.ptr((x$3 = $mul64(new $Uint64(0, 2), f.mant), new $Uint64(x$3.$high - 0, x$3.$low - 1)), f.exp - 1 >> 0, f.neg));
		} else {
			extFloat.copy(lower, new extFloat.ptr((x$4 = $mul64(new $Uint64(0, 4), f.mant), new $Uint64(x$4.$high - 0, x$4.$low - 1)), f.exp - 2 >> 0, f.neg));
		}
		return [lower, upper];
	};
	extFloat.prototype.AssignComputeBounds = function(mant, exp, neg, flt) { return this.$val.AssignComputeBounds(mant, exp, neg, flt); };
	extFloat.ptr.prototype.Normalize = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, exp, f, mant, shift, x, x$1, x$2, x$3, x$4, x$5;
		shift = 0;
		f = this;
		_tmp = f.mant;
		_tmp$1 = f.exp;
		mant = _tmp;
		exp = _tmp$1;
		if ((mant.$high === 0 && mant.$low === 0)) {
			shift = 0;
			return shift;
		}
		if ((x = $shiftRightUint64(mant, 32), (x.$high === 0 && x.$low === 0))) {
			mant = $shiftLeft64(mant, (32));
			exp = exp - (32) >> 0;
		}
		if ((x$1 = $shiftRightUint64(mant, 48), (x$1.$high === 0 && x$1.$low === 0))) {
			mant = $shiftLeft64(mant, (16));
			exp = exp - (16) >> 0;
		}
		if ((x$2 = $shiftRightUint64(mant, 56), (x$2.$high === 0 && x$2.$low === 0))) {
			mant = $shiftLeft64(mant, (8));
			exp = exp - (8) >> 0;
		}
		if ((x$3 = $shiftRightUint64(mant, 60), (x$3.$high === 0 && x$3.$low === 0))) {
			mant = $shiftLeft64(mant, (4));
			exp = exp - (4) >> 0;
		}
		if ((x$4 = $shiftRightUint64(mant, 62), (x$4.$high === 0 && x$4.$low === 0))) {
			mant = $shiftLeft64(mant, (2));
			exp = exp - (2) >> 0;
		}
		if ((x$5 = $shiftRightUint64(mant, 63), (x$5.$high === 0 && x$5.$low === 0))) {
			mant = $shiftLeft64(mant, (1));
			exp = exp - (1) >> 0;
		}
		shift = ((f.exp - exp >> 0) >>> 0);
		_tmp$2 = mant;
		_tmp$3 = exp;
		f.mant = _tmp$2;
		f.exp = _tmp$3;
		return shift;
	};
	extFloat.prototype.Normalize = function() { return this.$val.Normalize(); };
	extFloat.ptr.prototype.Multiply = function(g) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, cross1, cross2, f, fhi, flo, g, ghi, glo, rem, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		g = $clone(g, extFloat);
		f = this;
		_tmp = $shiftRightUint64(f.mant, 32);
		_tmp$1 = new $Uint64(0, (f.mant.$low >>> 0));
		fhi = _tmp;
		flo = _tmp$1;
		_tmp$2 = $shiftRightUint64(g.mant, 32);
		_tmp$3 = new $Uint64(0, (g.mant.$low >>> 0));
		ghi = _tmp$2;
		glo = _tmp$3;
		cross1 = $mul64(fhi, glo);
		cross2 = $mul64(flo, ghi);
		f.mant = (x = (x$1 = $mul64(fhi, ghi), x$2 = $shiftRightUint64(cross1, 32), new $Uint64(x$1.$high + x$2.$high, x$1.$low + x$2.$low)), x$3 = $shiftRightUint64(cross2, 32), new $Uint64(x.$high + x$3.$high, x.$low + x$3.$low));
		rem = (x$4 = (x$5 = new $Uint64(0, (cross1.$low >>> 0)), x$6 = new $Uint64(0, (cross2.$low >>> 0)), new $Uint64(x$5.$high + x$6.$high, x$5.$low + x$6.$low)), x$7 = $shiftRightUint64(($mul64(flo, glo)), 32), new $Uint64(x$4.$high + x$7.$high, x$4.$low + x$7.$low));
		rem = (x$8 = new $Uint64(0, 2147483648), new $Uint64(rem.$high + x$8.$high, rem.$low + x$8.$low));
		f.mant = (x$9 = f.mant, x$10 = ($shiftRightUint64(rem, 32)), new $Uint64(x$9.$high + x$10.$high, x$9.$low + x$10.$low));
		f.exp = (f.exp + g.exp >> 0) + 64 >> 0;
	};
	extFloat.prototype.Multiply = function(g) { return this.$val.Multiply(g); };
	extFloat.ptr.prototype.AssignDecimal = function(mantissa, exp10, neg, trunc, flt) {
		var $ptr, _q, _r, adjExp, denormalExp, errors$1, exp10, extrabits, f, flt, halfway, i, mant_extra, mantissa, neg, ok, shift, trunc, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y;
		ok = false;
		f = this;
		errors$1 = 0;
		if (trunc) {
			errors$1 = errors$1 + (4) >> 0;
		}
		f.mant = mantissa;
		f.exp = 0;
		f.neg = neg;
		i = (_q = ((exp10 - -348 >> 0)) / 8, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		if (exp10 < -348 || i >= 87) {
			ok = false;
			return ok;
		}
		adjExp = (_r = ((exp10 - -348 >> 0)) % 8, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		if (adjExp < 19 && (x = (x$1 = 19 - adjExp >> 0, ((x$1 < 0 || x$1 >= uint64pow10.length) ? $throwRuntimeError("index out of range") : uint64pow10[x$1])), (mantissa.$high < x.$high || (mantissa.$high === x.$high && mantissa.$low < x.$low)))) {
			f.mant = $mul64(f.mant, (((adjExp < 0 || adjExp >= uint64pow10.length) ? $throwRuntimeError("index out of range") : uint64pow10[adjExp])));
			f.Normalize();
		} else {
			f.Normalize();
			f.Multiply(((adjExp < 0 || adjExp >= smallPowersOfTen.length) ? $throwRuntimeError("index out of range") : smallPowersOfTen[adjExp]));
			errors$1 = errors$1 + (4) >> 0;
		}
		f.Multiply(((i < 0 || i >= powersOfTen.length) ? $throwRuntimeError("index out of range") : powersOfTen[i]));
		if (errors$1 > 0) {
			errors$1 = errors$1 + (1) >> 0;
		}
		errors$1 = errors$1 + (4) >> 0;
		shift = f.Normalize();
		errors$1 = (y = (shift), y < 32 ? (errors$1 << y) : 0) >> 0;
		denormalExp = flt.bias - 63 >> 0;
		extrabits = 0;
		if (f.exp <= denormalExp) {
			extrabits = ((63 - flt.mantbits >>> 0) + 1 >>> 0) + ((denormalExp - f.exp >> 0) >>> 0) >>> 0;
		} else {
			extrabits = 63 - flt.mantbits >>> 0;
		}
		halfway = $shiftLeft64(new $Uint64(0, 1), ((extrabits - 1 >>> 0)));
		mant_extra = (x$2 = f.mant, x$3 = (x$4 = $shiftLeft64(new $Uint64(0, 1), extrabits), new $Uint64(x$4.$high - 0, x$4.$low - 1)), new $Uint64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
		if ((x$5 = (x$6 = new $Int64(halfway.$high, halfway.$low), x$7 = new $Int64(0, errors$1), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low)), x$8 = new $Int64(mant_extra.$high, mant_extra.$low), (x$5.$high < x$8.$high || (x$5.$high === x$8.$high && x$5.$low < x$8.$low))) && (x$9 = new $Int64(mant_extra.$high, mant_extra.$low), x$10 = (x$11 = new $Int64(halfway.$high, halfway.$low), x$12 = new $Int64(0, errors$1), new $Int64(x$11.$high + x$12.$high, x$11.$low + x$12.$low)), (x$9.$high < x$10.$high || (x$9.$high === x$10.$high && x$9.$low < x$10.$low)))) {
			ok = false;
			return ok;
		}
		ok = true;
		return ok;
	};
	extFloat.prototype.AssignDecimal = function(mantissa, exp10, neg, trunc, flt) { return this.$val.AssignDecimal(mantissa, exp10, neg, trunc, flt); };
	extFloat.ptr.prototype.frexp10 = function() {
		var $ptr, _q, _q$1, _tmp, _tmp$1, approxExp10, exp, exp10, f, i, index;
		exp10 = 0;
		index = 0;
		f = this;
		approxExp10 = (_q = ($imul(((-46 - f.exp >> 0)), 28)) / 93, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		i = (_q$1 = ((approxExp10 - -348 >> 0)) / 8, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		Loop:
		while (true) {
			exp = (f.exp + ((i < 0 || i >= powersOfTen.length) ? $throwRuntimeError("index out of range") : powersOfTen[i]).exp >> 0) + 64 >> 0;
			if (exp < -60) {
				i = i + (1) >> 0;
			} else if (exp > -32) {
				i = i - (1) >> 0;
			} else {
				break Loop;
			}
		}
		f.Multiply(((i < 0 || i >= powersOfTen.length) ? $throwRuntimeError("index out of range") : powersOfTen[i]));
		_tmp = -((-348 + ($imul(i, 8)) >> 0));
		_tmp$1 = i;
		exp10 = _tmp;
		index = _tmp$1;
		return [exp10, index];
	};
	extFloat.prototype.frexp10 = function() { return this.$val.frexp10(); };
	frexp10Many = function(a, b, c) {
		var $ptr, _tuple, a, b, c, exp10, i;
		exp10 = 0;
		_tuple = c.frexp10();
		exp10 = _tuple[0];
		i = _tuple[1];
		a.Multiply(((i < 0 || i >= powersOfTen.length) ? $throwRuntimeError("index out of range") : powersOfTen[i]));
		b.Multiply(((i < 0 || i >= powersOfTen.length) ? $throwRuntimeError("index out of range") : powersOfTen[i]));
		return exp10;
	};
	extFloat.ptr.prototype.FixedDecimal = function(d, n) {
		var $CE$B5, $ptr, _q, _q$1, _tmp, _tmp$1, _tuple, buf, d, digit, exp10, f, fraction, i, i$1, i$2, integer, integerDigits, n, nd, needed, ok, pos, pow, pow10, rest, shift, v, v1, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		f = this;
		if ((x = f.mant, (x.$high === 0 && x.$low === 0))) {
			d.nd = 0;
			d.dp = 0;
			d.neg = f.neg;
			return true;
		}
		if (n === 0) {
			$panic(new $String("strconv: internal error: extFloat.FixedDecimal called with n == 0"));
		}
		f.Normalize();
		_tuple = f.frexp10();
		exp10 = _tuple[0];
		shift = (-f.exp >>> 0);
		integer = ($shiftRightUint64(f.mant, shift).$low >>> 0);
		fraction = (x$1 = f.mant, x$2 = $shiftLeft64(new $Uint64(0, integer), shift), new $Uint64(x$1.$high - x$2.$high, x$1.$low - x$2.$low));
		$CE$B5 = new $Uint64(0, 1);
		needed = n;
		integerDigits = 0;
		pow10 = new $Uint64(0, 1);
		_tmp = 0;
		_tmp$1 = new $Uint64(0, 1);
		i = _tmp;
		pow = _tmp$1;
		while (true) {
			if (!(i < 20)) { break; }
			if ((x$3 = new $Uint64(0, integer), (pow.$high > x$3.$high || (pow.$high === x$3.$high && pow.$low > x$3.$low)))) {
				integerDigits = i;
				break;
			}
			pow = $mul64(pow, (new $Uint64(0, 10)));
			i = i + (1) >> 0;
		}
		rest = integer;
		if (integerDigits > needed) {
			pow10 = (x$4 = integerDigits - needed >> 0, ((x$4 < 0 || x$4 >= uint64pow10.length) ? $throwRuntimeError("index out of range") : uint64pow10[x$4]));
			integer = (_q = integer / ((pow10.$low >>> 0)), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			rest = rest - (($imul(integer, (pow10.$low >>> 0)) >>> 0)) >>> 0;
		} else {
			rest = 0;
		}
		buf = arrayType$2.zero();
		pos = 32;
		v = integer;
		while (true) {
			if (!(v > 0)) { break; }
			v1 = (_q$1 = v / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
			v = v - (($imul(10, v1) >>> 0)) >>> 0;
			pos = pos - (1) >> 0;
			((pos < 0 || pos >= buf.length) ? $throwRuntimeError("index out of range") : buf[pos] = ((v + 48 >>> 0) << 24 >>> 24));
			v = v1;
		}
		i$1 = pos;
		while (true) {
			if (!(i$1 < 32)) { break; }
			(x$5 = d.d, x$6 = i$1 - pos >> 0, ((x$6 < 0 || x$6 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + x$6] = ((i$1 < 0 || i$1 >= buf.length) ? $throwRuntimeError("index out of range") : buf[i$1])));
			i$1 = i$1 + (1) >> 0;
		}
		nd = 32 - pos >> 0;
		d.nd = nd;
		d.dp = integerDigits + exp10 >> 0;
		needed = needed - (nd) >> 0;
		if (needed > 0) {
			if (!((rest === 0)) || !((pow10.$high === 0 && pow10.$low === 1))) {
				$panic(new $String("strconv: internal error, rest != 0 but needed > 0"));
			}
			while (true) {
				if (!(needed > 0)) { break; }
				fraction = $mul64(fraction, (new $Uint64(0, 10)));
				$CE$B5 = $mul64($CE$B5, (new $Uint64(0, 10)));
				if ((x$7 = $mul64(new $Uint64(0, 2), $CE$B5), x$8 = $shiftLeft64(new $Uint64(0, 1), shift), (x$7.$high > x$8.$high || (x$7.$high === x$8.$high && x$7.$low > x$8.$low)))) {
					return false;
				}
				digit = $shiftRightUint64(fraction, shift);
				(x$9 = d.d, ((nd < 0 || nd >= x$9.$length) ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + nd] = (new $Uint64(digit.$high + 0, digit.$low + 48).$low << 24 >>> 24)));
				fraction = (x$10 = $shiftLeft64(digit, shift), new $Uint64(fraction.$high - x$10.$high, fraction.$low - x$10.$low));
				nd = nd + (1) >> 0;
				needed = needed - (1) >> 0;
			}
			d.nd = nd;
		}
		ok = adjustLastDigitFixed(d, (x$11 = $shiftLeft64(new $Uint64(0, rest), shift), new $Uint64(x$11.$high | fraction.$high, (x$11.$low | fraction.$low) >>> 0)), pow10, shift, $CE$B5);
		if (!ok) {
			return false;
		}
		i$2 = d.nd - 1 >> 0;
		while (true) {
			if (!(i$2 >= 0)) { break; }
			if (!(((x$12 = d.d, ((i$2 < 0 || i$2 >= x$12.$length) ? $throwRuntimeError("index out of range") : x$12.$array[x$12.$offset + i$2])) === 48))) {
				d.nd = i$2 + 1 >> 0;
				break;
			}
			i$2 = i$2 - (1) >> 0;
		}
		return true;
	};
	extFloat.prototype.FixedDecimal = function(d, n) { return this.$val.FixedDecimal(d, n); };
	adjustLastDigitFixed = function(d, num, den, shift, $CE$B5) {
		var $CE$B5, $ptr, d, den, i, num, shift, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		if ((x = $shiftLeft64(den, shift), (num.$high > x.$high || (num.$high === x.$high && num.$low > x.$low)))) {
			$panic(new $String("strconv: num > den<<shift in adjustLastDigitFixed"));
		}
		if ((x$1 = $mul64(new $Uint64(0, 2), $CE$B5), x$2 = $shiftLeft64(den, shift), (x$1.$high > x$2.$high || (x$1.$high === x$2.$high && x$1.$low > x$2.$low)))) {
			$panic(new $String("strconv: \xCE\xB5 > (den<<shift)/2"));
		}
		if ((x$3 = $mul64(new $Uint64(0, 2), (new $Uint64(num.$high + $CE$B5.$high, num.$low + $CE$B5.$low))), x$4 = $shiftLeft64(den, shift), (x$3.$high < x$4.$high || (x$3.$high === x$4.$high && x$3.$low < x$4.$low)))) {
			return true;
		}
		if ((x$5 = $mul64(new $Uint64(0, 2), (new $Uint64(num.$high - $CE$B5.$high, num.$low - $CE$B5.$low))), x$6 = $shiftLeft64(den, shift), (x$5.$high > x$6.$high || (x$5.$high === x$6.$high && x$5.$low > x$6.$low)))) {
			i = d.nd - 1 >> 0;
			while (true) {
				if (!(i >= 0)) { break; }
				if ((x$7 = d.d, ((i < 0 || i >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + i])) === 57) {
					d.nd = d.nd - (1) >> 0;
				} else {
					break;
				}
				i = i - (1) >> 0;
			}
			if (i < 0) {
				(x$8 = d.d, (0 >= x$8.$length ? $throwRuntimeError("index out of range") : x$8.$array[x$8.$offset + 0] = 49));
				d.nd = 1;
				d.dp = d.dp + (1) >> 0;
			} else {
				(x$10 = d.d, ((i < 0 || i >= x$10.$length) ? $throwRuntimeError("index out of range") : x$10.$array[x$10.$offset + i] = ((x$9 = d.d, ((i < 0 || i >= x$9.$length) ? $throwRuntimeError("index out of range") : x$9.$array[x$9.$offset + i])) + (1) << 24 >>> 24)));
			}
			return true;
		}
		return false;
	};
	extFloat.ptr.prototype.ShortestDecimal = function(d, lower, upper) {
		var $ptr, _q, _tmp, _tmp$1, _tmp$2, _tmp$3, allowance, buf, currentDiff, d, digit, digit$1, exp10, f, fraction, i, i$1, i$2, integer, integerDigits, lower, multiplier, n, nd, pow, pow$1, shift, targetDiff, upper, v, v1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$20, x$21, x$22, x$23, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		f = this;
		if ((x = f.mant, (x.$high === 0 && x.$low === 0))) {
			d.nd = 0;
			d.dp = 0;
			d.neg = f.neg;
			return true;
		}
		if ((f.exp === 0) && $equal(lower, f, extFloat) && $equal(lower, upper, extFloat)) {
			buf = arrayType$1.zero();
			n = 23;
			v = f.mant;
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				v1 = $div64(v, new $Uint64(0, 10), false);
				v = (x$1 = $mul64(new $Uint64(0, 10), v1), new $Uint64(v.$high - x$1.$high, v.$low - x$1.$low));
				((n < 0 || n >= buf.length) ? $throwRuntimeError("index out of range") : buf[n] = (new $Uint64(v.$high + 0, v.$low + 48).$low << 24 >>> 24));
				n = n - (1) >> 0;
				v = v1;
			}
			nd = (24 - n >> 0) - 1 >> 0;
			i = 0;
			while (true) {
				if (!(i < nd)) { break; }
				(x$3 = d.d, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i] = (x$2 = (n + 1 >> 0) + i >> 0, ((x$2 < 0 || x$2 >= buf.length) ? $throwRuntimeError("index out of range") : buf[x$2]))));
				i = i + (1) >> 0;
			}
			_tmp = nd;
			_tmp$1 = nd;
			d.nd = _tmp;
			d.dp = _tmp$1;
			while (true) {
				if (!(d.nd > 0 && ((x$4 = d.d, x$5 = d.nd - 1 >> 0, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])) === 48))) { break; }
				d.nd = d.nd - (1) >> 0;
			}
			if (d.nd === 0) {
				d.dp = 0;
			}
			d.neg = f.neg;
			return true;
		}
		upper.Normalize();
		if (f.exp > upper.exp) {
			f.mant = $shiftLeft64(f.mant, (((f.exp - upper.exp >> 0) >>> 0)));
			f.exp = upper.exp;
		}
		if (lower.exp > upper.exp) {
			lower.mant = $shiftLeft64(lower.mant, (((lower.exp - upper.exp >> 0) >>> 0)));
			lower.exp = upper.exp;
		}
		exp10 = frexp10Many(lower, f, upper);
		upper.mant = (x$6 = upper.mant, x$7 = new $Uint64(0, 1), new $Uint64(x$6.$high + x$7.$high, x$6.$low + x$7.$low));
		lower.mant = (x$8 = lower.mant, x$9 = new $Uint64(0, 1), new $Uint64(x$8.$high - x$9.$high, x$8.$low - x$9.$low));
		shift = (-upper.exp >>> 0);
		integer = ($shiftRightUint64(upper.mant, shift).$low >>> 0);
		fraction = (x$10 = upper.mant, x$11 = $shiftLeft64(new $Uint64(0, integer), shift), new $Uint64(x$10.$high - x$11.$high, x$10.$low - x$11.$low));
		allowance = (x$12 = upper.mant, x$13 = lower.mant, new $Uint64(x$12.$high - x$13.$high, x$12.$low - x$13.$low));
		targetDiff = (x$14 = upper.mant, x$15 = f.mant, new $Uint64(x$14.$high - x$15.$high, x$14.$low - x$15.$low));
		integerDigits = 0;
		_tmp$2 = 0;
		_tmp$3 = new $Uint64(0, 1);
		i$1 = _tmp$2;
		pow = _tmp$3;
		while (true) {
			if (!(i$1 < 20)) { break; }
			if ((x$16 = new $Uint64(0, integer), (pow.$high > x$16.$high || (pow.$high === x$16.$high && pow.$low > x$16.$low)))) {
				integerDigits = i$1;
				break;
			}
			pow = $mul64(pow, (new $Uint64(0, 10)));
			i$1 = i$1 + (1) >> 0;
		}
		i$2 = 0;
		while (true) {
			if (!(i$2 < integerDigits)) { break; }
			pow$1 = (x$17 = (integerDigits - i$2 >> 0) - 1 >> 0, ((x$17 < 0 || x$17 >= uint64pow10.length) ? $throwRuntimeError("index out of range") : uint64pow10[x$17]));
			digit = (_q = integer / (pow$1.$low >>> 0), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			(x$18 = d.d, ((i$2 < 0 || i$2 >= x$18.$length) ? $throwRuntimeError("index out of range") : x$18.$array[x$18.$offset + i$2] = ((digit + 48 >>> 0) << 24 >>> 24)));
			integer = integer - (($imul(digit, (pow$1.$low >>> 0)) >>> 0)) >>> 0;
			currentDiff = (x$19 = $shiftLeft64(new $Uint64(0, integer), shift), new $Uint64(x$19.$high + fraction.$high, x$19.$low + fraction.$low));
			if ((currentDiff.$high < allowance.$high || (currentDiff.$high === allowance.$high && currentDiff.$low < allowance.$low))) {
				d.nd = i$2 + 1 >> 0;
				d.dp = integerDigits + exp10 >> 0;
				d.neg = f.neg;
				return adjustLastDigit(d, currentDiff, targetDiff, allowance, $shiftLeft64(pow$1, shift), new $Uint64(0, 2));
			}
			i$2 = i$2 + (1) >> 0;
		}
		d.nd = integerDigits;
		d.dp = d.nd + exp10 >> 0;
		d.neg = f.neg;
		digit$1 = 0;
		multiplier = new $Uint64(0, 1);
		while (true) {
			fraction = $mul64(fraction, (new $Uint64(0, 10)));
			multiplier = $mul64(multiplier, (new $Uint64(0, 10)));
			digit$1 = ($shiftRightUint64(fraction, shift).$low >> 0);
			(x$20 = d.d, x$21 = d.nd, ((x$21 < 0 || x$21 >= x$20.$length) ? $throwRuntimeError("index out of range") : x$20.$array[x$20.$offset + x$21] = ((digit$1 + 48 >> 0) << 24 >>> 24)));
			d.nd = d.nd + (1) >> 0;
			fraction = (x$22 = $shiftLeft64(new $Uint64(0, digit$1), shift), new $Uint64(fraction.$high - x$22.$high, fraction.$low - x$22.$low));
			if ((x$23 = $mul64(allowance, multiplier), (fraction.$high < x$23.$high || (fraction.$high === x$23.$high && fraction.$low < x$23.$low)))) {
				return adjustLastDigit(d, fraction, $mul64(targetDiff, multiplier), $mul64(allowance, multiplier), $shiftLeft64(new $Uint64(0, 1), shift), $mul64(multiplier, new $Uint64(0, 2)));
			}
		}
	};
	extFloat.prototype.ShortestDecimal = function(d, lower, upper) { return this.$val.ShortestDecimal(d, lower, upper); };
	adjustLastDigit = function(d, currentDiff, targetDiff, maxDiff, ulpDecimal, ulpBinary) {
		var $ptr, _index, currentDiff, d, maxDiff, targetDiff, ulpBinary, ulpDecimal, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		if ((x = $mul64(new $Uint64(0, 2), ulpBinary), (ulpDecimal.$high < x.$high || (ulpDecimal.$high === x.$high && ulpDecimal.$low < x.$low)))) {
			return false;
		}
		while (true) {
			if (!((x$1 = (x$2 = (x$3 = $div64(ulpDecimal, new $Uint64(0, 2), false), new $Uint64(currentDiff.$high + x$3.$high, currentDiff.$low + x$3.$low)), new $Uint64(x$2.$high + ulpBinary.$high, x$2.$low + ulpBinary.$low)), (x$1.$high < targetDiff.$high || (x$1.$high === targetDiff.$high && x$1.$low < targetDiff.$low))))) { break; }
			_index = d.nd - 1 >> 0;
			(x$5 = d.d, ((_index < 0 || _index >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + _index] = ((x$4 = d.d, ((_index < 0 || _index >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + _index])) - (1) << 24 >>> 24)));
			currentDiff = (x$6 = ulpDecimal, new $Uint64(currentDiff.$high + x$6.$high, currentDiff.$low + x$6.$low));
		}
		if ((x$7 = new $Uint64(currentDiff.$high + ulpDecimal.$high, currentDiff.$low + ulpDecimal.$low), x$8 = (x$9 = (x$10 = $div64(ulpDecimal, new $Uint64(0, 2), false), new $Uint64(targetDiff.$high + x$10.$high, targetDiff.$low + x$10.$low)), new $Uint64(x$9.$high + ulpBinary.$high, x$9.$low + ulpBinary.$low)), (x$7.$high < x$8.$high || (x$7.$high === x$8.$high && x$7.$low <= x$8.$low)))) {
			return false;
		}
		if ((currentDiff.$high < ulpBinary.$high || (currentDiff.$high === ulpBinary.$high && currentDiff.$low < ulpBinary.$low)) || (x$11 = new $Uint64(maxDiff.$high - ulpBinary.$high, maxDiff.$low - ulpBinary.$low), (currentDiff.$high > x$11.$high || (currentDiff.$high === x$11.$high && currentDiff.$low > x$11.$low)))) {
			return false;
		}
		if ((d.nd === 1) && ((x$12 = d.d, (0 >= x$12.$length ? $throwRuntimeError("index out of range") : x$12.$array[x$12.$offset + 0])) === 48)) {
			d.nd = 0;
			d.dp = 0;
		}
		return true;
	};
	AppendFloat = function(dst, f, fmt, prec, bitSize) {
		var $ptr, bitSize, dst, f, fmt, prec;
		return genericFtoa(dst, f, fmt, prec, bitSize);
	};
	$pkg.AppendFloat = AppendFloat;
	genericFtoa = function(dst, val, fmt, prec, bitSize) {
		var $ptr, _1, _2, _3, _4, _tuple, bitSize, bits, buf, buf$1, digits, digs, dst, exp, f, f$1, flt, fmt, lower, mant, neg, ok, prec, s, shortest, upper, val, x, x$1, x$2, x$3, y, y$1;
		bits = new $Uint64(0, 0);
		flt = ptrType$1.nil;
		_1 = bitSize;
		if (_1 === (32)) {
			bits = new $Uint64(0, math.Float32bits($fround(val)));
			flt = float32info;
		} else if (_1 === (64)) {
			bits = math.Float64bits(val);
			flt = float64info;
		} else {
			$panic(new $String("strconv: illegal AppendFloat/FormatFloat bitSize"));
		}
		neg = !((x = $shiftRightUint64(bits, ((flt.expbits + flt.mantbits >>> 0))), (x.$high === 0 && x.$low === 0)));
		exp = ($shiftRightUint64(bits, flt.mantbits).$low >> 0) & ((((y = flt.expbits, y < 32 ? (1 << y) : 0) >> 0) - 1 >> 0));
		mant = (x$1 = (x$2 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(x$2.$high - 0, x$2.$low - 1)), new $Uint64(bits.$high & x$1.$high, (bits.$low & x$1.$low) >>> 0));
		_2 = exp;
		if (_2 === ((((y$1 = flt.expbits, y$1 < 32 ? (1 << y$1) : 0) >> 0) - 1 >> 0))) {
			s = "";
			if (!((mant.$high === 0 && mant.$low === 0))) {
				s = "NaN";
			} else if (neg) {
				s = "-Inf";
			} else {
				s = "+Inf";
			}
			return $appendSlice(dst, s);
		} else if (_2 === (0)) {
			exp = exp + (1) >> 0;
		} else {
			mant = (x$3 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), new $Uint64(mant.$high | x$3.$high, (mant.$low | x$3.$low) >>> 0));
		}
		exp = exp + (flt.bias) >> 0;
		if (fmt === 98) {
			return fmtB(dst, neg, mant, exp, flt);
		}
		if (!optimize) {
			return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
		}
		digs = new decimalSlice.ptr(sliceType$6.nil, 0, 0, false);
		ok = false;
		shortest = prec < 0;
		if (shortest) {
			f = new extFloat.ptr(new $Uint64(0, 0), 0, false);
			_tuple = f.AssignComputeBounds(mant, exp, neg, flt);
			lower = $clone(_tuple[0], extFloat);
			upper = $clone(_tuple[1], extFloat);
			buf = arrayType$2.zero();
			digs.d = new sliceType$6(buf);
			ok = f.ShortestDecimal(digs, lower, upper);
			if (!ok) {
				return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
			}
			_3 = fmt;
			if ((_3 === (101)) || (_3 === (69))) {
				prec = max(digs.nd - 1 >> 0, 0);
			} else if (_3 === (102)) {
				prec = max(digs.nd - digs.dp >> 0, 0);
			} else if ((_3 === (103)) || (_3 === (71))) {
				prec = digs.nd;
			}
		} else if (!((fmt === 102))) {
			digits = prec;
			_4 = fmt;
			if ((_4 === (101)) || (_4 === (69))) {
				digits = digits + (1) >> 0;
			} else if ((_4 === (103)) || (_4 === (71))) {
				if (prec === 0) {
					prec = 1;
				}
				digits = prec;
			}
			if (digits <= 15) {
				buf$1 = arrayType$1.zero();
				digs.d = new sliceType$6(buf$1);
				f$1 = new extFloat.ptr(mant, exp - (flt.mantbits >> 0) >> 0, neg);
				ok = f$1.FixedDecimal(digs, digits);
			}
		}
		if (!ok) {
			return bigFtoa(dst, prec, fmt, neg, mant, exp, flt);
		}
		return formatDigits(dst, shortest, neg, digs, prec, fmt);
	};
	bigFtoa = function(dst, prec, fmt, neg, mant, exp, flt) {
		var $ptr, _1, _2, d, digs, dst, exp, flt, fmt, mant, neg, prec, shortest;
		d = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		d.Assign(mant);
		d.Shift(exp - (flt.mantbits >> 0) >> 0);
		digs = new decimalSlice.ptr(sliceType$6.nil, 0, 0, false);
		shortest = prec < 0;
		if (shortest) {
			roundShortest(d, mant, exp, flt);
			decimalSlice.copy(digs, new decimalSlice.ptr(new sliceType$6(d.d), d.nd, d.dp, false));
			_1 = fmt;
			if ((_1 === (101)) || (_1 === (69))) {
				prec = digs.nd - 1 >> 0;
			} else if (_1 === (102)) {
				prec = max(digs.nd - digs.dp >> 0, 0);
			} else if ((_1 === (103)) || (_1 === (71))) {
				prec = digs.nd;
			}
		} else {
			_2 = fmt;
			if ((_2 === (101)) || (_2 === (69))) {
				d.Round(prec + 1 >> 0);
			} else if (_2 === (102)) {
				d.Round(d.dp + prec >> 0);
			} else if ((_2 === (103)) || (_2 === (71))) {
				if (prec === 0) {
					prec = 1;
				}
				d.Round(prec);
			}
			decimalSlice.copy(digs, new decimalSlice.ptr(new sliceType$6(d.d), d.nd, d.dp, false));
		}
		return formatDigits(dst, shortest, neg, digs, prec, fmt);
	};
	formatDigits = function(dst, shortest, neg, digs, prec, fmt) {
		var $ptr, _1, digs, dst, eprec, exp, fmt, neg, prec, shortest;
		digs = $clone(digs, decimalSlice);
		_1 = fmt;
		if ((_1 === (101)) || (_1 === (69))) {
			return fmtE(dst, neg, digs, prec, fmt);
		} else if (_1 === (102)) {
			return fmtF(dst, neg, digs, prec);
		} else if ((_1 === (103)) || (_1 === (71))) {
			eprec = prec;
			if (eprec > digs.nd && digs.nd >= digs.dp) {
				eprec = digs.nd;
			}
			if (shortest) {
				eprec = 6;
			}
			exp = digs.dp - 1 >> 0;
			if (exp < -4 || exp >= eprec) {
				if (prec > digs.nd) {
					prec = digs.nd;
				}
				return fmtE(dst, neg, digs, prec - 1 >> 0, (fmt + 101 << 24 >>> 24) - 103 << 24 >>> 24);
			}
			if (prec > digs.dp) {
				prec = digs.nd;
			}
			return fmtF(dst, neg, digs, max(prec - digs.dp >> 0, 0));
		}
		return $append(dst, 37, fmt);
	};
	roundShortest = function(d, mant, exp, flt) {
		var $ptr, d, exp, explo, flt, i, inclusive, l, lower, m, mant, mantlo, minexp, okdown, okup, u, upper, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		if ((mant.$high === 0 && mant.$low === 0)) {
			d.nd = 0;
			return;
		}
		minexp = flt.bias + 1 >> 0;
		if (exp > minexp && ($imul(332, ((d.dp - d.nd >> 0)))) >= ($imul(100, ((exp - (flt.mantbits >> 0) >> 0))))) {
			return;
		}
		upper = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		upper.Assign((x = $mul64(mant, new $Uint64(0, 2)), new $Uint64(x.$high + 0, x.$low + 1)));
		upper.Shift((exp - (flt.mantbits >> 0) >> 0) - 1 >> 0);
		mantlo = new $Uint64(0, 0);
		explo = 0;
		if ((x$1 = $shiftLeft64(new $Uint64(0, 1), flt.mantbits), (mant.$high > x$1.$high || (mant.$high === x$1.$high && mant.$low > x$1.$low))) || (exp === minexp)) {
			mantlo = new $Uint64(mant.$high - 0, mant.$low - 1);
			explo = exp;
		} else {
			mantlo = (x$2 = $mul64(mant, new $Uint64(0, 2)), new $Uint64(x$2.$high - 0, x$2.$low - 1));
			explo = exp - 1 >> 0;
		}
		lower = new decimal.ptr(arrayType.zero(), 0, 0, false, false);
		lower.Assign((x$3 = $mul64(mantlo, new $Uint64(0, 2)), new $Uint64(x$3.$high + 0, x$3.$low + 1)));
		lower.Shift((explo - (flt.mantbits >> 0) >> 0) - 1 >> 0);
		inclusive = (x$4 = $div64(mant, new $Uint64(0, 2), true), (x$4.$high === 0 && x$4.$low === 0));
		i = 0;
		while (true) {
			if (!(i < d.nd)) { break; }
			l = 48;
			if (i < lower.nd) {
				l = (x$5 = lower.d, ((i < 0 || i >= x$5.length) ? $throwRuntimeError("index out of range") : x$5[i]));
			}
			m = (x$6 = d.d, ((i < 0 || i >= x$6.length) ? $throwRuntimeError("index out of range") : x$6[i]));
			u = 48;
			if (i < upper.nd) {
				u = (x$7 = upper.d, ((i < 0 || i >= x$7.length) ? $throwRuntimeError("index out of range") : x$7[i]));
			}
			okdown = !((l === m)) || inclusive && ((i + 1 >> 0) === lower.nd);
			okup = !((m === u)) && (inclusive || (m + 1 << 24 >>> 24) < u || (i + 1 >> 0) < upper.nd);
			if (okdown && okup) {
				d.Round(i + 1 >> 0);
				return;
			} else if (okdown) {
				d.RoundDown(i + 1 >> 0);
				return;
			} else if (okup) {
				d.RoundUp(i + 1 >> 0);
				return;
			}
			i = i + (1) >> 0;
		}
	};
	fmtE = function(dst, neg, d, prec, fmt) {
		var $ptr, _q, _q$1, _q$2, _r, _r$1, _r$2, ch, d, dst, exp, fmt, i, m, neg, prec, x;
		d = $clone(d, decimalSlice);
		if (neg) {
			dst = $append(dst, 45);
		}
		ch = 48;
		if (!((d.nd === 0))) {
			ch = (x = d.d, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		}
		dst = $append(dst, ch);
		if (prec > 0) {
			dst = $append(dst, 46);
			i = 1;
			m = min(d.nd, prec + 1 >> 0);
			if (i < m) {
				dst = $appendSlice(dst, $subslice(d.d, i, m));
				i = m;
			}
			while (true) {
				if (!(i <= prec)) { break; }
				dst = $append(dst, 48);
				i = i + (1) >> 0;
			}
		}
		dst = $append(dst, fmt);
		exp = d.dp - 1 >> 0;
		if (d.nd === 0) {
			exp = 0;
		}
		if (exp < 0) {
			ch = 45;
			exp = -exp;
		} else {
			ch = 43;
		}
		dst = $append(dst, ch);
		if (exp < 10) {
			dst = $append(dst, 48, (exp << 24 >>> 24) + 48 << 24 >>> 24);
		} else if (exp < 100) {
			dst = $append(dst, ((_q = exp / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24) + 48 << 24 >>> 24, ((_r = exp % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) << 24 >>> 24) + 48 << 24 >>> 24);
		} else {
			dst = $append(dst, ((_q$1 = exp / 100, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24) + 48 << 24 >>> 24, (_r$1 = ((_q$2 = exp / 10, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24) % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 << 24 >>> 24, ((_r$2 = exp % 10, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) << 24 >>> 24) + 48 << 24 >>> 24);
		}
		return dst;
	};
	fmtF = function(dst, neg, d, prec) {
		var $ptr, ch, d, dst, i, j, m, neg, prec, x;
		d = $clone(d, decimalSlice);
		if (neg) {
			dst = $append(dst, 45);
		}
		if (d.dp > 0) {
			m = min(d.nd, d.dp);
			dst = $appendSlice(dst, $subslice(d.d, 0, m));
			while (true) {
				if (!(m < d.dp)) { break; }
				dst = $append(dst, 48);
				m = m + (1) >> 0;
			}
		} else {
			dst = $append(dst, 48);
		}
		if (prec > 0) {
			dst = $append(dst, 46);
			i = 0;
			while (true) {
				if (!(i < prec)) { break; }
				ch = 48;
				j = d.dp + i >> 0;
				if (0 <= j && j < d.nd) {
					ch = (x = d.d, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j]));
				}
				dst = $append(dst, ch);
				i = i + (1) >> 0;
			}
		}
		return dst;
	};
	fmtB = function(dst, neg, mant, exp, flt) {
		var $ptr, _tuple, _tuple$1, dst, exp, flt, mant, neg;
		if (neg) {
			dst = $append(dst, 45);
		}
		_tuple = formatBits(dst, mant, 10, false, true);
		dst = _tuple[0];
		dst = $append(dst, 112);
		exp = exp - ((flt.mantbits >> 0)) >> 0;
		if (exp >= 0) {
			dst = $append(dst, 43);
		}
		_tuple$1 = formatBits(dst, new $Uint64(0, exp), 10, exp < 0, true);
		dst = _tuple$1[0];
		return dst;
	};
	min = function(a, b) {
		var $ptr, a, b;
		if (a < b) {
			return a;
		}
		return b;
	};
	max = function(a, b) {
		var $ptr, a, b;
		if (a > b) {
			return a;
		}
		return b;
	};
	FormatInt = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, new $Uint64(i.$high, i.$low), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var $ptr, i;
		return FormatInt(new $Int64(0, i), 10);
	};
	$pkg.Itoa = Itoa;
	formatBits = function(dst, u, base, neg, append_) {
		var $ptr, _q, _q$1, a, append_, b, b$1, base, d, dst, i, j, m, neg, q, q$1, q$2, qs, s, s$1, u, us, us$1, x, x$1;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low > 4294967295)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = ((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0);
					j = 9;
					while (true) {
						if (!(j > 0)) { break; }
						i = i - (1) >> 0;
						qs = (_q = us / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us - ($imul(qs, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
						us = qs;
						j = j - (1) >> 0;
					}
					u = q;
				}
			}
			us$1 = (u.$low >>> 0);
			while (true) {
				if (!(us$1 >= 10)) { break; }
				i = i - (1) >> 0;
				q$1 = (_q$1 = us$1 / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us$1 - ($imul(q$1, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
				us$1 = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = ((us$1 + 48 >>> 0) << 24 >>> 24));
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? $throwRuntimeError("index out of range") : shifts[base]);
			if (s$1 > 0) {
				b = new $Uint64(0, base);
				m = (b.$low >>> 0) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((u.$low >>> 0) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			} else {
				b$1 = new $Uint64(0, base);
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$2 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((x$1 = $mul64(q$2, b$1), new $Uint64(u.$high - x$1.$high, u.$low - x$1.$low)).$low >>> 0)));
					u = q$2;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = $bytesToString($subslice(new sliceType$6(a), i));
		return [d, s];
	};
	appendQuotedWith = function(buf, s, quote, ASCIIonly, graphicOnly) {
		var $ptr, ASCIIonly, _tuple, buf, graphicOnly, quote, r, s, width;
		buf = $append(buf, quote);
		width = 0;
		while (true) {
			if (!(s.length > 0)) { break; }
			r = (s.charCodeAt(0) >> 0);
			width = 1;
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				width = _tuple[1];
			}
			if ((width === 1) && (r === 65533)) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				s = $substring(s, width);
				continue;
			}
			buf = appendEscapedRune(buf, r, width, quote, ASCIIonly, graphicOnly);
			s = $substring(s, width);
		}
		buf = $append(buf, quote);
		return buf;
	};
	appendQuotedRuneWith = function(buf, r, quote, ASCIIonly, graphicOnly) {
		var $ptr, ASCIIonly, buf, graphicOnly, quote, r;
		buf = $append(buf, quote);
		if (!utf8.ValidRune(r)) {
			r = 65533;
		}
		buf = appendEscapedRune(buf, r, utf8.RuneLen(r), quote, ASCIIonly, graphicOnly);
		buf = $append(buf, quote);
		return buf;
	};
	appendEscapedRune = function(buf, r, width, quote, ASCIIonly, graphicOnly) {
		var $ptr, ASCIIonly, _1, buf, graphicOnly, n, quote, r, runeTmp, s, s$1, width;
		runeTmp = arrayType$4.zero();
		if ((r === (quote >> 0)) || (r === 92)) {
			buf = $append(buf, 92);
			buf = $append(buf, (r << 24 >>> 24));
			return buf;
		}
		if (ASCIIonly) {
			if (r < 128 && IsPrint(r)) {
				buf = $append(buf, (r << 24 >>> 24));
				return buf;
			}
		} else if (IsPrint(r) || graphicOnly && isInGraphicList(r)) {
			n = utf8.EncodeRune(new sliceType$6(runeTmp), r);
			buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n));
			return buf;
		}
		_1 = r;
		if (_1 === (7)) {
			buf = $appendSlice(buf, "\\a");
		} else if (_1 === (8)) {
			buf = $appendSlice(buf, "\\b");
		} else if (_1 === (12)) {
			buf = $appendSlice(buf, "\\f");
		} else if (_1 === (10)) {
			buf = $appendSlice(buf, "\\n");
		} else if (_1 === (13)) {
			buf = $appendSlice(buf, "\\r");
		} else if (_1 === (9)) {
			buf = $appendSlice(buf, "\\t");
		} else if (_1 === (11)) {
			buf = $appendSlice(buf, "\\v");
		} else {
			if (r < 32) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt(((r << 24 >>> 24) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt((((r << 24 >>> 24) & 15) >>> 0)));
			} else if (r > 1114111) {
				r = 65533;
				buf = $appendSlice(buf, "\\u");
				s = 12;
				while (true) {
					if (!(s >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s >>> 0), 31)) >> 0) & 15)));
					s = s - (4) >> 0;
				}
			} else if (r < 65536) {
				buf = $appendSlice(buf, "\\u");
				s = 12;
				while (true) {
					if (!(s >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s >>> 0), 31)) >> 0) & 15)));
					s = s - (4) >> 0;
				}
			} else {
				buf = $appendSlice(buf, "\\U");
				s$1 = 28;
				while (true) {
					if (!(s$1 >= 0)) { break; }
					buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$1 >>> 0), 31)) >> 0) & 15)));
					s$1 = s$1 - (4) >> 0;
				}
			}
		}
		return buf;
	};
	AppendQuote = function(dst, s) {
		var $ptr, dst, s;
		return appendQuotedWith(dst, s, 34, false, false);
	};
	$pkg.AppendQuote = AppendQuote;
	AppendQuoteToASCII = function(dst, s) {
		var $ptr, dst, s;
		return appendQuotedWith(dst, s, 34, true, false);
	};
	$pkg.AppendQuoteToASCII = AppendQuoteToASCII;
	AppendQuoteRune = function(dst, r) {
		var $ptr, dst, r;
		return appendQuotedRuneWith(dst, r, 39, false, false);
	};
	$pkg.AppendQuoteRune = AppendQuoteRune;
	AppendQuoteRuneToASCII = function(dst, r) {
		var $ptr, dst, r;
		return appendQuotedRuneWith(dst, r, 39, true, false);
	};
	$pkg.AppendQuoteRuneToASCII = AppendQuoteRuneToASCII;
	CanBackquote = function(s) {
		var $ptr, _tuple, r, s, wid;
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			wid = _tuple[1];
			s = $substring(s, wid);
			if (wid > 1) {
				if (r === 65279) {
					return false;
				}
				continue;
			}
			if (r === 65533) {
				return false;
			}
			if ((r < 32 && !((r === 9))) || (r === 96) || (r === 127)) {
				return false;
			}
		}
		return true;
	};
	$pkg.CanBackquote = CanBackquote;
	unhex = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, c, ok, v;
		v = 0;
		ok = false;
		c = (b >> 0);
		if (48 <= c && c <= 57) {
			_tmp = c - 48 >> 0;
			_tmp$1 = true;
			v = _tmp;
			ok = _tmp$1;
			return [v, ok];
		} else if (97 <= c && c <= 102) {
			_tmp$2 = (c - 97 >> 0) + 10 >> 0;
			_tmp$3 = true;
			v = _tmp$2;
			ok = _tmp$3;
			return [v, ok];
		} else if (65 <= c && c <= 70) {
			_tmp$4 = (c - 65 >> 0) + 10 >> 0;
			_tmp$5 = true;
			v = _tmp$4;
			ok = _tmp$5;
			return [v, ok];
		}
		return [v, ok];
	};
	UnquoteChar = function(s, quote) {
		var $ptr, _1, _2, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, c, c$1, err, j, j$1, multibyte, n, ok, quote, r, s, size, tail, v, v$1, value, x, x$1;
		value = 0;
		multibyte = false;
		tail = "";
		err = $ifaceNil;
		c = s.charCodeAt(0);
		if ((c === quote) && ((quote === 39) || (quote === 34))) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		} else if (c >= 128) {
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			size = _tuple[1];
			_tmp = r;
			_tmp$1 = true;
			_tmp$2 = $substring(s, size);
			_tmp$3 = $ifaceNil;
			value = _tmp;
			multibyte = _tmp$1;
			tail = _tmp$2;
			err = _tmp$3;
			return [value, multibyte, tail, err];
		} else if (!((c === 92))) {
			_tmp$4 = (s.charCodeAt(0) >> 0);
			_tmp$5 = false;
			_tmp$6 = $substring(s, 1);
			_tmp$7 = $ifaceNil;
			value = _tmp$4;
			multibyte = _tmp$5;
			tail = _tmp$6;
			err = _tmp$7;
			return [value, multibyte, tail, err];
		}
		if (s.length <= 1) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		}
		c$1 = s.charCodeAt(1);
		s = $substring(s, 2);
		switch (0) { default:
			_1 = c$1;
			if (_1 === (97)) {
				value = 7;
			} else if (_1 === (98)) {
				value = 8;
			} else if (_1 === (102)) {
				value = 12;
			} else if (_1 === (110)) {
				value = 10;
			} else if (_1 === (114)) {
				value = 13;
			} else if (_1 === (116)) {
				value = 9;
			} else if (_1 === (118)) {
				value = 11;
			} else if ((_1 === (120)) || (_1 === (117)) || (_1 === (85))) {
				n = 0;
				_2 = c$1;
				if (_2 === (120)) {
					n = 2;
				} else if (_2 === (117)) {
					n = 4;
				} else if (_2 === (85)) {
					n = 8;
				}
				v = 0;
				if (s.length < n) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j = 0;
				while (true) {
					if (!(j < n)) { break; }
					_tuple$1 = unhex(s.charCodeAt(j));
					x = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v = (v << 4 >> 0) | x;
					j = j + (1) >> 0;
				}
				s = $substring(s, n);
				if (c$1 === 120) {
					value = v;
					break;
				}
				if (v > 1114111) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v;
				multibyte = true;
			} else if ((_1 === (48)) || (_1 === (49)) || (_1 === (50)) || (_1 === (51)) || (_1 === (52)) || (_1 === (53)) || (_1 === (54)) || (_1 === (55))) {
				v$1 = (c$1 >> 0) - 48 >> 0;
				if (s.length < 2) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j$1 = 0;
				while (true) {
					if (!(j$1 < 2)) { break; }
					x$1 = (s.charCodeAt(j$1) >> 0) - 48 >> 0;
					if (x$1 < 0 || x$1 > 7) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v$1 = ((v$1 << 3 >> 0)) | x$1;
					j$1 = j$1 + (1) >> 0;
				}
				s = $substring(s, 2);
				if (v$1 > 255) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v$1;
			} else if (_1 === (92)) {
				value = 92;
			} else if ((_1 === (39)) || (_1 === (34))) {
				if (!((c$1 === quote))) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = (c$1 >> 0);
			} else {
				err = $pkg.ErrSyntax;
				return [value, multibyte, tail, err];
			}
		}
		tail = s;
		return [value, multibyte, tail, err];
	};
	$pkg.UnquoteChar = UnquoteChar;
	Unquote = function(s) {
		var $ptr, _1, _q, _tuple, _tuple$1, buf, c, err, multibyte, n, n$1, quote, r, runeTmp, s, size, ss;
		n = s.length;
		if (n < 2) {
			return ["", $pkg.ErrSyntax];
		}
		quote = s.charCodeAt(0);
		if (!((quote === s.charCodeAt((n - 1 >> 0))))) {
			return ["", $pkg.ErrSyntax];
		}
		s = $substring(s, 1, (n - 1 >> 0));
		if (quote === 96) {
			if (contains(s, 96)) {
				return ["", $pkg.ErrSyntax];
			}
			return [s, $ifaceNil];
		}
		if (!((quote === 34)) && !((quote === 39))) {
			return ["", $pkg.ErrSyntax];
		}
		if (contains(s, 10)) {
			return ["", $pkg.ErrSyntax];
		}
		if (!contains(s, 92) && !contains(s, quote)) {
			_1 = quote;
			if (_1 === (34)) {
				return [s, $ifaceNil];
			} else if (_1 === (39)) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				size = _tuple[1];
				if ((size === s.length) && (!((r === 65533)) || !((size === 1)))) {
					return [s, $ifaceNil];
				}
			}
		}
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple$1 = UnquoteChar(s, quote);
			c = _tuple$1[0];
			multibyte = _tuple$1[1];
			ss = _tuple$1[2];
			err = _tuple$1[3];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return ["", err];
			}
			s = ss;
			if (c < 128 || !multibyte) {
				buf = $append(buf, (c << 24 >>> 24));
			} else {
				n$1 = utf8.EncodeRune(new sliceType$6(runeTmp), c);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n$1));
			}
			if ((quote === 39) && !((s.length === 0))) {
				return ["", $pkg.ErrSyntax];
			}
		}
		return [$bytesToString(buf), $ifaceNil];
	};
	$pkg.Unquote = Unquote;
	contains = function(s, c) {
		var $ptr, c, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === c) {
				return true;
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	bsearch16 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	bsearch32 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	IsPrint = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, i, i$1, isNotPrint, isNotPrint$1, isPrint, isPrint$1, j, j$1, r, rr, rr$1, x, x$1, x$2, x$3;
		if (r <= 255) {
			if (32 <= r && r <= 126) {
				return true;
			}
			if (161 <= r && r <= 255) {
				return !((r === 173));
			}
			return false;
		}
		if (0 <= r && r < 65536) {
			_tmp = (r << 16 >>> 16);
			_tmp$1 = isPrint16;
			_tmp$2 = isNotPrint16;
			rr = _tmp;
			isPrint = _tmp$1;
			isNotPrint = _tmp$2;
			i = bsearch16(isPrint, rr);
			if (i >= isPrint.$length || rr < (x = (i & ~1) >> 0, ((x < 0 || x >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x])) || (x$1 = i | 1, ((x$1 < 0 || x$1 >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x$1])) < rr) {
				return false;
			}
			j = bsearch16(isNotPrint, rr);
			return j >= isNotPrint.$length || !((((j < 0 || j >= isNotPrint.$length) ? $throwRuntimeError("index out of range") : isNotPrint.$array[isNotPrint.$offset + j]) === rr));
		}
		_tmp$3 = (r >>> 0);
		_tmp$4 = isPrint32;
		_tmp$5 = isNotPrint32;
		rr$1 = _tmp$3;
		isPrint$1 = _tmp$4;
		isNotPrint$1 = _tmp$5;
		i$1 = bsearch32(isPrint$1, rr$1);
		if (i$1 >= isPrint$1.$length || rr$1 < (x$2 = (i$1 & ~1) >> 0, ((x$2 < 0 || x$2 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$2])) || (x$3 = i$1 | 1, ((x$3 < 0 || x$3 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$3])) < rr$1) {
			return false;
		}
		if (r >= 131072) {
			return true;
		}
		r = r - (65536) >> 0;
		j$1 = bsearch16(isNotPrint$1, (r << 16 >>> 16));
		return j$1 >= isNotPrint$1.$length || !((((j$1 < 0 || j$1 >= isNotPrint$1.$length) ? $throwRuntimeError("index out of range") : isNotPrint$1.$array[isNotPrint$1.$offset + j$1]) === (r << 16 >>> 16)));
	};
	$pkg.IsPrint = IsPrint;
	isInGraphicList = function(r) {
		var $ptr, i, r, rr;
		if (r > 65535) {
			return false;
		}
		rr = (r << 16 >>> 16);
		i = bsearch16(isGraphic, rr);
		return i < isGraphic.$length && (rr === ((i < 0 || i >= isGraphic.$length) ? $throwRuntimeError("index out of range") : isGraphic.$array[isGraphic.$offset + i]));
	};
	ptrType$2.methods = [{prop: "set", name: "set", pkg: "strconv", typ: $funcType([$String], [$Bool], false)}, {prop: "floatBits", name: "floatBits", pkg: "strconv", typ: $funcType([ptrType$1], [$Uint64, $Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Assign", name: "Assign", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "Shift", name: "Shift", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundDown", name: "RoundDown", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundUp", name: "RoundUp", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "RoundedInteger", name: "RoundedInteger", pkg: "", typ: $funcType([], [$Uint64], false)}];
	ptrType$4.methods = [{prop: "floatBits", name: "floatBits", pkg: "strconv", typ: $funcType([ptrType$1], [$Uint64, $Bool], false)}, {prop: "AssignComputeBounds", name: "AssignComputeBounds", pkg: "", typ: $funcType([$Uint64, $Int, $Bool, ptrType$1], [extFloat, extFloat], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [$Uint], false)}, {prop: "Multiply", name: "Multiply", pkg: "", typ: $funcType([extFloat], [], false)}, {prop: "AssignDecimal", name: "AssignDecimal", pkg: "", typ: $funcType([$Uint64, $Int, $Bool, $Bool, ptrType$1], [$Bool], false)}, {prop: "frexp10", name: "frexp10", pkg: "strconv", typ: $funcType([], [$Int, $Int], false)}, {prop: "FixedDecimal", name: "FixedDecimal", pkg: "", typ: $funcType([ptrType$3, $Int], [$Bool], false)}, {prop: "ShortestDecimal", name: "ShortestDecimal", pkg: "", typ: $funcType([ptrType$3, ptrType$4, ptrType$4], [$Bool], false)}];
	decimal.init("strconv", [{prop: "d", name: "d", exported: false, typ: arrayType, tag: ""}, {prop: "nd", name: "nd", exported: false, typ: $Int, tag: ""}, {prop: "dp", name: "dp", exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", exported: false, typ: $Bool, tag: ""}, {prop: "trunc", name: "trunc", exported: false, typ: $Bool, tag: ""}]);
	leftCheat.init("strconv", [{prop: "delta", name: "delta", exported: false, typ: $Int, tag: ""}, {prop: "cutoff", name: "cutoff", exported: false, typ: $String, tag: ""}]);
	extFloat.init("strconv", [{prop: "mant", name: "mant", exported: false, typ: $Uint64, tag: ""}, {prop: "exp", name: "exp", exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", exported: false, typ: $Bool, tag: ""}]);
	floatInfo.init("strconv", [{prop: "mantbits", name: "mantbits", exported: false, typ: $Uint, tag: ""}, {prop: "expbits", name: "expbits", exported: false, typ: $Uint, tag: ""}, {prop: "bias", name: "bias", exported: false, typ: $Int, tag: ""}]);
	decimalSlice.init("strconv", [{prop: "d", name: "d", exported: false, typ: sliceType$6, tag: ""}, {prop: "nd", name: "nd", exported: false, typ: $Int, tag: ""}, {prop: "dp", name: "dp", exported: false, typ: $Int, tag: ""}, {prop: "neg", name: "neg", exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		optimize = true;
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		leftcheats = new sliceType$3([new leftCheat.ptr(0, ""), new leftCheat.ptr(1, "5"), new leftCheat.ptr(1, "25"), new leftCheat.ptr(1, "125"), new leftCheat.ptr(2, "625"), new leftCheat.ptr(2, "3125"), new leftCheat.ptr(2, "15625"), new leftCheat.ptr(3, "78125"), new leftCheat.ptr(3, "390625"), new leftCheat.ptr(3, "1953125"), new leftCheat.ptr(4, "9765625"), new leftCheat.ptr(4, "48828125"), new leftCheat.ptr(4, "244140625"), new leftCheat.ptr(4, "1220703125"), new leftCheat.ptr(5, "6103515625"), new leftCheat.ptr(5, "30517578125"), new leftCheat.ptr(5, "152587890625"), new leftCheat.ptr(6, "762939453125"), new leftCheat.ptr(6, "3814697265625"), new leftCheat.ptr(6, "19073486328125"), new leftCheat.ptr(7, "95367431640625"), new leftCheat.ptr(7, "476837158203125"), new leftCheat.ptr(7, "2384185791015625"), new leftCheat.ptr(7, "11920928955078125"), new leftCheat.ptr(8, "59604644775390625"), new leftCheat.ptr(8, "298023223876953125"), new leftCheat.ptr(8, "1490116119384765625"), new leftCheat.ptr(9, "7450580596923828125"), new leftCheat.ptr(9, "37252902984619140625"), new leftCheat.ptr(9, "186264514923095703125"), new leftCheat.ptr(10, "931322574615478515625"), new leftCheat.ptr(10, "4656612873077392578125"), new leftCheat.ptr(10, "23283064365386962890625"), new leftCheat.ptr(10, "116415321826934814453125"), new leftCheat.ptr(11, "582076609134674072265625"), new leftCheat.ptr(11, "2910383045673370361328125"), new leftCheat.ptr(11, "14551915228366851806640625"), new leftCheat.ptr(12, "72759576141834259033203125"), new leftCheat.ptr(12, "363797880709171295166015625"), new leftCheat.ptr(12, "1818989403545856475830078125"), new leftCheat.ptr(13, "9094947017729282379150390625"), new leftCheat.ptr(13, "45474735088646411895751953125"), new leftCheat.ptr(13, "227373675443232059478759765625"), new leftCheat.ptr(13, "1136868377216160297393798828125"), new leftCheat.ptr(14, "5684341886080801486968994140625"), new leftCheat.ptr(14, "28421709430404007434844970703125"), new leftCheat.ptr(14, "142108547152020037174224853515625"), new leftCheat.ptr(15, "710542735760100185871124267578125"), new leftCheat.ptr(15, "3552713678800500929355621337890625"), new leftCheat.ptr(15, "17763568394002504646778106689453125"), new leftCheat.ptr(16, "88817841970012523233890533447265625"), new leftCheat.ptr(16, "444089209850062616169452667236328125"), new leftCheat.ptr(16, "2220446049250313080847263336181640625"), new leftCheat.ptr(16, "11102230246251565404236316680908203125"), new leftCheat.ptr(17, "55511151231257827021181583404541015625"), new leftCheat.ptr(17, "277555756156289135105907917022705078125"), new leftCheat.ptr(17, "1387778780781445675529539585113525390625"), new leftCheat.ptr(18, "6938893903907228377647697925567626953125"), new leftCheat.ptr(18, "34694469519536141888238489627838134765625"), new leftCheat.ptr(18, "173472347597680709441192448139190673828125"), new leftCheat.ptr(19, "867361737988403547205962240695953369140625")]);
		smallPowersOfTen = $toNativeArray($kindStruct, [new extFloat.ptr(new $Uint64(2147483648, 0), -63, false), new extFloat.ptr(new $Uint64(2684354560, 0), -60, false), new extFloat.ptr(new $Uint64(3355443200, 0), -57, false), new extFloat.ptr(new $Uint64(4194304000, 0), -54, false), new extFloat.ptr(new $Uint64(2621440000, 0), -50, false), new extFloat.ptr(new $Uint64(3276800000, 0), -47, false), new extFloat.ptr(new $Uint64(4096000000, 0), -44, false), new extFloat.ptr(new $Uint64(2560000000, 0), -40, false)]);
		powersOfTen = $toNativeArray($kindStruct, [new extFloat.ptr(new $Uint64(4203730336, 136053384), -1220, false), new extFloat.ptr(new $Uint64(3132023167, 2722021238), -1193, false), new extFloat.ptr(new $Uint64(2333539104, 810921078), -1166, false), new extFloat.ptr(new $Uint64(3477244234, 1573795306), -1140, false), new extFloat.ptr(new $Uint64(2590748842, 1432697645), -1113, false), new extFloat.ptr(new $Uint64(3860516611, 1025131999), -1087, false), new extFloat.ptr(new $Uint64(2876309015, 3348809418), -1060, false), new extFloat.ptr(new $Uint64(4286034428, 3200048207), -1034, false), new extFloat.ptr(new $Uint64(3193344495, 1097586188), -1007, false), new extFloat.ptr(new $Uint64(2379227053, 2424306748), -980, false), new extFloat.ptr(new $Uint64(3545324584, 827693699), -954, false), new extFloat.ptr(new $Uint64(2641472655, 2913388981), -927, false), new extFloat.ptr(new $Uint64(3936100983, 602835915), -901, false), new extFloat.ptr(new $Uint64(2932623761, 1081627501), -874, false), new extFloat.ptr(new $Uint64(2184974969, 1572261463), -847, false), new extFloat.ptr(new $Uint64(3255866422, 1308317239), -821, false), new extFloat.ptr(new $Uint64(2425809519, 944281679), -794, false), new extFloat.ptr(new $Uint64(3614737867, 629291719), -768, false), new extFloat.ptr(new $Uint64(2693189581, 2545915892), -741, false), new extFloat.ptr(new $Uint64(4013165208, 388672741), -715, false), new extFloat.ptr(new $Uint64(2990041083, 708162190), -688, false), new extFloat.ptr(new $Uint64(2227754207, 3536207675), -661, false), new extFloat.ptr(new $Uint64(3319612455, 450088378), -635, false), new extFloat.ptr(new $Uint64(2473304014, 3139815830), -608, false), new extFloat.ptr(new $Uint64(3685510180, 2103616900), -582, false), new extFloat.ptr(new $Uint64(2745919064, 224385782), -555, false), new extFloat.ptr(new $Uint64(4091738259, 3737383206), -529, false), new extFloat.ptr(new $Uint64(3048582568, 2868871352), -502, false), new extFloat.ptr(new $Uint64(2271371013, 1820084875), -475, false), new extFloat.ptr(new $Uint64(3384606560, 885076051), -449, false), new extFloat.ptr(new $Uint64(2521728396, 2444895829), -422, false), new extFloat.ptr(new $Uint64(3757668132, 1881767613), -396, false), new extFloat.ptr(new $Uint64(2799680927, 3102062735), -369, false), new extFloat.ptr(new $Uint64(4171849679, 2289335700), -343, false), new extFloat.ptr(new $Uint64(3108270227, 2410191823), -316, false), new extFloat.ptr(new $Uint64(2315841784, 3205436779), -289, false), new extFloat.ptr(new $Uint64(3450873173, 1697722806), -263, false), new extFloat.ptr(new $Uint64(2571100870, 3497754540), -236, false), new extFloat.ptr(new $Uint64(3831238852, 707476230), -210, false), new extFloat.ptr(new $Uint64(2854495385, 1769181907), -183, false), new extFloat.ptr(new $Uint64(4253529586, 2197867022), -157, false), new extFloat.ptr(new $Uint64(3169126500, 2450594539), -130, false), new extFloat.ptr(new $Uint64(2361183241, 1867548876), -103, false), new extFloat.ptr(new $Uint64(3518437208, 3793315116), -77, false), new extFloat.ptr(new $Uint64(2621440000, 0), -50, false), new extFloat.ptr(new $Uint64(3906250000, 0), -24, false), new extFloat.ptr(new $Uint64(2910383045, 2892103680), 3, false), new extFloat.ptr(new $Uint64(2168404344, 4170451332), 30, false), new extFloat.ptr(new $Uint64(3231174267, 3372684723), 56, false), new extFloat.ptr(new $Uint64(2407412430, 2078956656), 83, false), new extFloat.ptr(new $Uint64(3587324068, 2884206696), 109, false), new extFloat.ptr(new $Uint64(2672764710, 395977285), 136, false), new extFloat.ptr(new $Uint64(3982729777, 3569679143), 162, false), new extFloat.ptr(new $Uint64(2967364920, 2361961896), 189, false), new extFloat.ptr(new $Uint64(2210859150, 447440347), 216, false), new extFloat.ptr(new $Uint64(3294436857, 1114709402), 242, false), new extFloat.ptr(new $Uint64(2454546732, 2786846552), 269, false), new extFloat.ptr(new $Uint64(3657559652, 443583978), 295, false), new extFloat.ptr(new $Uint64(2725094297, 2599384906), 322, false), new extFloat.ptr(new $Uint64(4060706939, 3028118405), 348, false), new extFloat.ptr(new $Uint64(3025462433, 2044532855), 375, false), new extFloat.ptr(new $Uint64(2254145170, 1536935362), 402, false), new extFloat.ptr(new $Uint64(3358938053, 3365297469), 428, false), new extFloat.ptr(new $Uint64(2502603868, 4204241075), 455, false), new extFloat.ptr(new $Uint64(3729170365, 2577424355), 481, false), new extFloat.ptr(new $Uint64(2778448436, 3677981733), 508, false), new extFloat.ptr(new $Uint64(4140210802, 2744688476), 534, false), new extFloat.ptr(new $Uint64(3084697427, 1424604878), 561, false), new extFloat.ptr(new $Uint64(2298278679, 4062331362), 588, false), new extFloat.ptr(new $Uint64(3424702107, 3546052773), 614, false), new extFloat.ptr(new $Uint64(2551601907, 2065781727), 641, false), new extFloat.ptr(new $Uint64(3802183132, 2535403578), 667, false), new extFloat.ptr(new $Uint64(2832847187, 1558426518), 694, false), new extFloat.ptr(new $Uint64(4221271257, 2762425404), 720, false), new extFloat.ptr(new $Uint64(3145092172, 2812560400), 747, false), new extFloat.ptr(new $Uint64(2343276271, 3057687578), 774, false), new extFloat.ptr(new $Uint64(3491753744, 2790753324), 800, false), new extFloat.ptr(new $Uint64(2601559269, 3918606633), 827, false), new extFloat.ptr(new $Uint64(3876625403, 2711358621), 853, false), new extFloat.ptr(new $Uint64(2888311001, 1648096297), 880, false), new extFloat.ptr(new $Uint64(2151959390, 2057817989), 907, false), new extFloat.ptr(new $Uint64(3206669376, 61660461), 933, false), new extFloat.ptr(new $Uint64(2389154863, 1581580175), 960, false), new extFloat.ptr(new $Uint64(3560118173, 2626467905), 986, false), new extFloat.ptr(new $Uint64(2652494738, 3034782633), 1013, false), new extFloat.ptr(new $Uint64(3952525166, 3135207385), 1039, false), new extFloat.ptr(new $Uint64(2944860731, 2616258155), 1066, false)]);
		uint64pow10 = $toNativeArray($kindUint64, [new $Uint64(0, 1), new $Uint64(0, 10), new $Uint64(0, 100), new $Uint64(0, 1000), new $Uint64(0, 10000), new $Uint64(0, 100000), new $Uint64(0, 1000000), new $Uint64(0, 10000000), new $Uint64(0, 100000000), new $Uint64(0, 1000000000), new $Uint64(2, 1410065408), new $Uint64(23, 1215752192), new $Uint64(232, 3567587328), new $Uint64(2328, 1316134912), new $Uint64(23283, 276447232), new $Uint64(232830, 2764472320), new $Uint64(2328306, 1874919424), new $Uint64(23283064, 1569325056), new $Uint64(232830643, 2808348672), new $Uint64(2328306436, 2313682944)]);
		float32info = new floatInfo.ptr(23, 8, -127);
		float64info = new floatInfo.ptr(52, 11, -1023);
		isPrint16 = new sliceType$4([32, 126, 161, 887, 890, 895, 900, 1366, 1369, 1418, 1421, 1479, 1488, 1514, 1520, 1524, 1542, 1563, 1566, 1805, 1808, 1866, 1869, 1969, 1984, 2042, 2048, 2093, 2096, 2139, 2142, 2142, 2208, 2237, 2260, 2444, 2447, 2448, 2451, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2531, 2534, 2555, 2561, 2570, 2575, 2576, 2579, 2617, 2620, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2654, 2662, 2677, 2689, 2745, 2748, 2765, 2768, 2768, 2784, 2787, 2790, 2801, 2809, 2809, 2817, 2828, 2831, 2832, 2835, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2915, 2918, 2935, 2946, 2954, 2958, 2965, 2969, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3021, 3024, 3024, 3031, 3031, 3046, 3066, 3072, 3129, 3133, 3149, 3157, 3162, 3168, 3171, 3174, 3183, 3192, 3257, 3260, 3277, 3285, 3286, 3294, 3299, 3302, 3314, 3329, 3386, 3389, 3407, 3412, 3427, 3430, 3455, 3458, 3478, 3482, 3517, 3520, 3526, 3530, 3530, 3535, 3551, 3558, 3567, 3570, 3572, 3585, 3642, 3647, 3675, 3713, 3716, 3719, 3722, 3725, 3725, 3732, 3751, 3754, 3773, 3776, 3789, 3792, 3801, 3804, 3807, 3840, 3948, 3953, 4058, 4096, 4295, 4301, 4301, 4304, 4685, 4688, 4701, 4704, 4749, 4752, 4789, 4792, 4805, 4808, 4885, 4888, 4954, 4957, 4988, 4992, 5017, 5024, 5109, 5112, 5117, 5120, 5788, 5792, 5880, 5888, 5908, 5920, 5942, 5952, 5971, 5984, 6003, 6016, 6109, 6112, 6121, 6128, 6137, 6144, 6157, 6160, 6169, 6176, 6263, 6272, 6314, 6320, 6389, 6400, 6443, 6448, 6459, 6464, 6464, 6468, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6618, 6622, 6683, 6686, 6780, 6783, 6793, 6800, 6809, 6816, 6829, 6832, 6846, 6912, 6987, 6992, 7036, 7040, 7155, 7164, 7223, 7227, 7241, 7245, 7304, 7360, 7367, 7376, 7417, 7424, 7669, 7675, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8061, 8064, 8147, 8150, 8175, 8178, 8190, 8208, 8231, 8240, 8286, 8304, 8305, 8308, 8348, 8352, 8382, 8400, 8432, 8448, 8587, 8592, 9254, 9280, 9290, 9312, 11123, 11126, 11157, 11160, 11193, 11197, 11217, 11244, 11247, 11264, 11507, 11513, 11559, 11565, 11565, 11568, 11623, 11631, 11632, 11647, 11670, 11680, 11844, 11904, 12019, 12032, 12245, 12272, 12283, 12289, 12438, 12441, 12543, 12549, 12589, 12593, 12730, 12736, 12771, 12784, 19893, 19904, 40917, 40960, 42124, 42128, 42182, 42192, 42539, 42560, 42743, 42752, 42935, 42999, 43051, 43056, 43065, 43072, 43127, 43136, 43205, 43214, 43225, 43232, 43261, 43264, 43347, 43359, 43388, 43392, 43481, 43486, 43574, 43584, 43597, 43600, 43609, 43612, 43714, 43739, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43877, 43888, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64449, 64467, 64831, 64848, 64911, 64914, 64967, 65008, 65021, 65024, 65049, 65056, 65131, 65136, 65276, 65281, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65504, 65518, 65532, 65533]);
		isNotPrint16 = new sliceType$4([173, 907, 909, 930, 1328, 1376, 1416, 1424, 1757, 2111, 2229, 2274, 2436, 2473, 2481, 2526, 2564, 2601, 2609, 2612, 2615, 2621, 2653, 2692, 2702, 2706, 2729, 2737, 2740, 2758, 2762, 2820, 2857, 2865, 2868, 2910, 2948, 2961, 2971, 2973, 3017, 3076, 3085, 3089, 3113, 3141, 3145, 3159, 3204, 3213, 3217, 3241, 3252, 3269, 3273, 3295, 3312, 3332, 3341, 3345, 3397, 3401, 3460, 3506, 3516, 3541, 3543, 3715, 3721, 3736, 3744, 3748, 3750, 3756, 3770, 3781, 3783, 3912, 3992, 4029, 4045, 4294, 4681, 4695, 4697, 4745, 4785, 4799, 4801, 4823, 4881, 5760, 5901, 5997, 6001, 6431, 6751, 7415, 8024, 8026, 8028, 8030, 8117, 8133, 8156, 8181, 8335, 9215, 11209, 11311, 11359, 11558, 11687, 11695, 11703, 11711, 11719, 11727, 11735, 11743, 11930, 12352, 12687, 12831, 13055, 42927, 43470, 43519, 43815, 43823, 64311, 64317, 64319, 64322, 64325, 65107, 65127, 65141, 65511]);
		isPrint32 = new sliceType$5([65536, 65613, 65616, 65629, 65664, 65786, 65792, 65794, 65799, 65843, 65847, 65947, 65952, 65952, 66000, 66045, 66176, 66204, 66208, 66256, 66272, 66299, 66304, 66339, 66352, 66378, 66384, 66426, 66432, 66499, 66504, 66517, 66560, 66717, 66720, 66729, 66736, 66771, 66776, 66811, 66816, 66855, 66864, 66915, 66927, 66927, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67640, 67644, 67644, 67647, 67742, 67751, 67759, 67808, 67829, 67835, 67867, 67871, 67897, 67903, 67903, 67968, 68023, 68028, 68047, 68050, 68102, 68108, 68147, 68152, 68154, 68159, 68167, 68176, 68184, 68192, 68255, 68288, 68326, 68331, 68342, 68352, 68405, 68409, 68437, 68440, 68466, 68472, 68497, 68505, 68508, 68521, 68527, 68608, 68680, 68736, 68786, 68800, 68850, 68858, 68863, 69216, 69246, 69632, 69709, 69714, 69743, 69759, 69825, 69840, 69864, 69872, 69881, 69888, 69955, 69968, 70006, 70016, 70093, 70096, 70132, 70144, 70206, 70272, 70313, 70320, 70378, 70384, 70393, 70400, 70412, 70415, 70416, 70419, 70457, 70460, 70468, 70471, 70472, 70475, 70477, 70480, 70480, 70487, 70487, 70493, 70499, 70502, 70508, 70512, 70516, 70656, 70749, 70784, 70855, 70864, 70873, 71040, 71093, 71096, 71133, 71168, 71236, 71248, 71257, 71264, 71276, 71296, 71351, 71360, 71369, 71424, 71449, 71453, 71467, 71472, 71487, 71840, 71922, 71935, 71935, 72384, 72440, 72704, 72773, 72784, 72812, 72816, 72847, 72850, 72886, 73728, 74649, 74752, 74868, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92777, 92782, 92783, 92880, 92909, 92912, 92917, 92928, 92997, 93008, 93047, 93053, 93071, 93952, 94020, 94032, 94078, 94095, 94111, 94176, 94176, 94208, 100332, 100352, 101106, 110592, 110593, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 113820, 113823, 118784, 119029, 119040, 119078, 119081, 119154, 119163, 119272, 119296, 119365, 119552, 119638, 119648, 119665, 119808, 119967, 119970, 119970, 119973, 119974, 119977, 120074, 120077, 120134, 120138, 120485, 120488, 120779, 120782, 121483, 121499, 121519, 122880, 122904, 122907, 122922, 124928, 125124, 125127, 125142, 125184, 125258, 125264, 125273, 125278, 125279, 126464, 126500, 126503, 126523, 126530, 126530, 126535, 126548, 126551, 126564, 126567, 126619, 126625, 126651, 126704, 126705, 126976, 127019, 127024, 127123, 127136, 127150, 127153, 127221, 127232, 127244, 127248, 127339, 127344, 127404, 127462, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127744, 128722, 128736, 128748, 128752, 128758, 128768, 128883, 128896, 128980, 129024, 129035, 129040, 129095, 129104, 129113, 129120, 129159, 129168, 129197, 129296, 129319, 129328, 129328, 129331, 129355, 129360, 129374, 129408, 129425, 129472, 129472, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 194560, 195101, 917760, 917999]);
		isNotPrint32 = new sliceType$4([12, 39, 59, 62, 399, 926, 2057, 2102, 2134, 2291, 2564, 2580, 2584, 4285, 4405, 4576, 4626, 4743, 4745, 4750, 4766, 4868, 4905, 4913, 4916, 5210, 5212, 7177, 7223, 7336, 9327, 27231, 27482, 27490, 54357, 54429, 54445, 54458, 54460, 54468, 54534, 54549, 54557, 54586, 54591, 54597, 54609, 55968, 57351, 57378, 57381, 60932, 60960, 60963, 60968, 60979, 60984, 60986, 61000, 61002, 61004, 61008, 61011, 61016, 61018, 61020, 61022, 61024, 61027, 61035, 61043, 61048, 61053, 61055, 61066, 61092, 61098, 61632, 61648, 61743, 63775, 63807]);
		isGraphic = new sliceType$4([160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 12288]);
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["reflect"] = (function() {
	var $pkg = {}, $init, errors, js, math, runtime, strconv, sync, uncommonType, funcType, name, nameData, mapIter, Type, Kind, tflag, rtype, typeAlg, method, ChanDir, arrayType, chanType, imethod, interfaceType, mapType, ptrType, sliceType, structField, structType, Method, nameOff, typeOff, textOff, StructField, StructTag, fieldScan, Value, flag, ValueError, sliceType$1, ptrType$1, sliceType$2, sliceType$3, mapType$1, structType$1, sliceType$5, ptrType$3, funcType$1, sliceType$6, ptrType$4, ptrType$5, sliceType$7, sliceType$8, ptrType$6, ptrType$7, structType$8, sliceType$9, sliceType$10, sliceType$11, sliceType$12, ptrType$8, ptrType$9, sliceType$14, sliceType$15, ptrType$10, sliceType$16, ptrType$16, sliceType$18, ptrType$17, funcType$3, funcType$4, funcType$5, arrayType$12, ptrType$18, initialized, uncommonTypeMap, nameMap, nameOffList, typeOffList, callHelper, jsObjectPtr, selectHelper, kindNames, methodCache, uint8Type, init, jsType, reflectType, setKindType, newName, newNameOff, newTypeOff, internalStr, isWrapped, copyStruct, makeValue, MakeSlice, TypeOf, ValueOf, FuncOf, SliceOf, Zero, unsafe_New, makeInt, typedmemmove, keyFor, mapaccess, mapassign, mapdelete, mapiterinit, mapiterkey, mapiternext, maplen, cvtDirect, methodReceiver, valueInterface, ifaceE2I, methodName, makeMethodValue, wrapJsObject, unwrapJsObject, getJsTag, chanrecv, chansend, PtrTo, implements$1, directlyAssignable, haveIdenticalUnderlyingType, toType, ifaceIndir, overflowFloat32, New, convertOp, makeFloat, makeComplex, makeString, makeBytes, makeRunes, cvtInt, cvtUint, cvtFloatInt, cvtFloatUint, cvtIntFloat, cvtUintFloat, cvtFloat, cvtComplex, cvtIntString, cvtUintString, cvtBytesString, cvtStringBytes, cvtRunesString, cvtStringRunes, cvtT2I, cvtI2I;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	math = $packages["math"];
	runtime = $packages["runtime"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	uncommonType = $pkg.uncommonType = $newType(0, $kindStruct, "reflect.uncommonType", true, "reflect", false, function(pkgPath_, mcount_, _$2_, moff_, _$4_, _methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pkgPath = 0;
			this.mcount = 0;
			this._$2 = 0;
			this.moff = 0;
			this._$4 = 0;
			this._methods = sliceType$3.nil;
			return;
		}
		this.pkgPath = pkgPath_;
		this.mcount = mcount_;
		this._$2 = _$2_;
		this.moff = moff_;
		this._$4 = _$4_;
		this._methods = _methods_;
	});
	funcType = $pkg.funcType = $newType(0, $kindStruct, "reflect.funcType", true, "reflect", false, function(rtype_, inCount_, outCount_, _in_, _out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.inCount = 0;
			this.outCount = 0;
			this._in = sliceType$2.nil;
			this._out = sliceType$2.nil;
			return;
		}
		this.rtype = rtype_;
		this.inCount = inCount_;
		this.outCount = outCount_;
		this._in = _in_;
		this._out = _out_;
	});
	name = $pkg.name = $newType(0, $kindStruct, "reflect.name", true, "reflect", false, function(bytes_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.bytes = ptrType$5.nil;
			return;
		}
		this.bytes = bytes_;
	});
	nameData = $pkg.nameData = $newType(0, $kindStruct, "reflect.nameData", true, "reflect", false, function(name_, tag_, pkgPath_, exported_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.tag = "";
			this.pkgPath = "";
			this.exported = false;
			return;
		}
		this.name = name_;
		this.tag = tag_;
		this.pkgPath = pkgPath_;
		this.exported = exported_;
	});
	mapIter = $pkg.mapIter = $newType(0, $kindStruct, "reflect.mapIter", true, "reflect", false, function(t_, m_, keys_, i_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.t = $ifaceNil;
			this.m = null;
			this.keys = null;
			this.i = 0;
			return;
		}
		this.t = t_;
		this.m = m_;
		this.keys = keys_;
		this.i = i_;
	});
	Type = $pkg.Type = $newType(8, $kindInterface, "reflect.Type", true, "reflect", true, null);
	Kind = $pkg.Kind = $newType(4, $kindUint, "reflect.Kind", true, "reflect", true, null);
	tflag = $pkg.tflag = $newType(1, $kindUint8, "reflect.tflag", true, "reflect", false, null);
	rtype = $pkg.rtype = $newType(0, $kindStruct, "reflect.rtype", true, "reflect", false, function(size_, ptrdata_, hash_, tflag_, align_, fieldAlign_, kind_, alg_, gcdata_, str_, ptrToThis_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.size = 0;
			this.ptrdata = 0;
			this.hash = 0;
			this.tflag = 0;
			this.align = 0;
			this.fieldAlign = 0;
			this.kind = 0;
			this.alg = ptrType$4.nil;
			this.gcdata = ptrType$5.nil;
			this.str = 0;
			this.ptrToThis = 0;
			return;
		}
		this.size = size_;
		this.ptrdata = ptrdata_;
		this.hash = hash_;
		this.tflag = tflag_;
		this.align = align_;
		this.fieldAlign = fieldAlign_;
		this.kind = kind_;
		this.alg = alg_;
		this.gcdata = gcdata_;
		this.str = str_;
		this.ptrToThis = ptrToThis_;
	});
	typeAlg = $pkg.typeAlg = $newType(0, $kindStruct, "reflect.typeAlg", true, "reflect", false, function(hash_, equal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.hash = $throwNilPointerError;
			this.equal = $throwNilPointerError;
			return;
		}
		this.hash = hash_;
		this.equal = equal_;
	});
	method = $pkg.method = $newType(0, $kindStruct, "reflect.method", true, "reflect", false, function(name_, mtyp_, ifn_, tfn_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.mtyp = 0;
			this.ifn = 0;
			this.tfn = 0;
			return;
		}
		this.name = name_;
		this.mtyp = mtyp_;
		this.ifn = ifn_;
		this.tfn = tfn_;
	});
	ChanDir = $pkg.ChanDir = $newType(4, $kindInt, "reflect.ChanDir", true, "reflect", true, null);
	arrayType = $pkg.arrayType = $newType(0, $kindStruct, "reflect.arrayType", true, "reflect", false, function(rtype_, elem_, slice_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.slice = ptrType$1.nil;
			this.len = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.slice = slice_;
		this.len = len_;
	});
	chanType = $pkg.chanType = $newType(0, $kindStruct, "reflect.chanType", true, "reflect", false, function(rtype_, elem_, dir_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.dir = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.dir = dir_;
	});
	imethod = $pkg.imethod = $newType(0, $kindStruct, "reflect.imethod", true, "reflect", false, function(name_, typ_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.typ = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
	});
	interfaceType = $pkg.interfaceType = $newType(0, $kindStruct, "reflect.interfaceType", true, "reflect", false, function(rtype_, pkgPath_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$5.nil);
			this.methods = sliceType$7.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.methods = methods_;
	});
	mapType = $pkg.mapType = $newType(0, $kindStruct, "reflect.mapType", true, "reflect", false, function(rtype_, key_, elem_, bucket_, hmap_, keysize_, indirectkey_, valuesize_, indirectvalue_, bucketsize_, reflexivekey_, needkeyupdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.key = ptrType$1.nil;
			this.elem = ptrType$1.nil;
			this.bucket = ptrType$1.nil;
			this.hmap = ptrType$1.nil;
			this.keysize = 0;
			this.indirectkey = 0;
			this.valuesize = 0;
			this.indirectvalue = 0;
			this.bucketsize = 0;
			this.reflexivekey = false;
			this.needkeyupdate = false;
			return;
		}
		this.rtype = rtype_;
		this.key = key_;
		this.elem = elem_;
		this.bucket = bucket_;
		this.hmap = hmap_;
		this.keysize = keysize_;
		this.indirectkey = indirectkey_;
		this.valuesize = valuesize_;
		this.indirectvalue = indirectvalue_;
		this.bucketsize = bucketsize_;
		this.reflexivekey = reflexivekey_;
		this.needkeyupdate = needkeyupdate_;
	});
	ptrType = $pkg.ptrType = $newType(0, $kindStruct, "reflect.ptrType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	sliceType = $pkg.sliceType = $newType(0, $kindStruct, "reflect.sliceType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	structField = $pkg.structField = $newType(0, $kindStruct, "reflect.structField", true, "reflect", false, function(name_, typ_, offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = new name.ptr(ptrType$5.nil);
			this.typ = ptrType$1.nil;
			this.offset = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
		this.offset = offset_;
	});
	structType = $pkg.structType = $newType(0, $kindStruct, "reflect.structType", true, "reflect", false, function(rtype_, pkgPath_, fields_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$5.nil);
			this.fields = sliceType$8.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.fields = fields_;
	});
	Method = $pkg.Method = $newType(0, $kindStruct, "reflect.Method", true, "reflect", true, function(Name_, PkgPath_, Type_, Func_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Func = new Value.ptr(ptrType$1.nil, 0, 0);
			this.Index = 0;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Func = Func_;
		this.Index = Index_;
	});
	nameOff = $pkg.nameOff = $newType(4, $kindInt32, "reflect.nameOff", true, "reflect", false, null);
	typeOff = $pkg.typeOff = $newType(4, $kindInt32, "reflect.typeOff", true, "reflect", false, null);
	textOff = $pkg.textOff = $newType(4, $kindInt32, "reflect.textOff", true, "reflect", false, null);
	StructField = $pkg.StructField = $newType(0, $kindStruct, "reflect.StructField", true, "reflect", true, function(Name_, PkgPath_, Type_, Tag_, Offset_, Index_, Anonymous_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Tag = "";
			this.Offset = 0;
			this.Index = sliceType$14.nil;
			this.Anonymous = false;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Tag = Tag_;
		this.Offset = Offset_;
		this.Index = Index_;
		this.Anonymous = Anonymous_;
	});
	StructTag = $pkg.StructTag = $newType(8, $kindString, "reflect.StructTag", true, "reflect", true, null);
	fieldScan = $pkg.fieldScan = $newType(0, $kindStruct, "reflect.fieldScan", true, "reflect", false, function(typ_, index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$10.nil;
			this.index = sliceType$14.nil;
			return;
		}
		this.typ = typ_;
		this.index = index_;
	});
	Value = $pkg.Value = $newType(0, $kindStruct, "reflect.Value", true, "reflect", true, function(typ_, ptr_, flag_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$1.nil;
			this.ptr = 0;
			this.flag = 0;
			return;
		}
		this.typ = typ_;
		this.ptr = ptr_;
		this.flag = flag_;
	});
	flag = $pkg.flag = $newType(4, $kindUintptr, "reflect.flag", true, "reflect", false, null);
	ValueError = $pkg.ValueError = $newType(0, $kindStruct, "reflect.ValueError", true, "reflect", true, function(Method_, Kind_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.Kind = 0;
			return;
		}
		this.Method = Method_;
		this.Kind = Kind_;
	});
	sliceType$1 = $sliceType(name);
	ptrType$1 = $ptrType(rtype);
	sliceType$2 = $sliceType(ptrType$1);
	sliceType$3 = $sliceType(method);
	mapType$1 = $mapType(ptrType$1, sliceType$3);
	structType$1 = $structType("reflect", [{prop: "RWMutex", name: "", exported: true, typ: sync.RWMutex, tag: ""}, {prop: "m", name: "m", exported: false, typ: mapType$1, tag: ""}]);
	sliceType$5 = $sliceType($emptyInterface);
	ptrType$3 = $ptrType(js.Object);
	funcType$1 = $funcType([sliceType$5], [ptrType$3], true);
	sliceType$6 = $sliceType($String);
	ptrType$4 = $ptrType(typeAlg);
	ptrType$5 = $ptrType($Uint8);
	sliceType$7 = $sliceType(imethod);
	sliceType$8 = $sliceType(structField);
	ptrType$6 = $ptrType(uncommonType);
	ptrType$7 = $ptrType(nameData);
	structType$8 = $structType("reflect", [{prop: "str", name: "str", exported: false, typ: $String, tag: ""}]);
	sliceType$9 = $sliceType(ptrType$3);
	sliceType$10 = $sliceType(Value);
	sliceType$11 = $sliceType(Type);
	sliceType$12 = $sliceType(sliceType$9);
	ptrType$8 = $ptrType(interfaceType);
	ptrType$9 = $ptrType(imethod);
	sliceType$14 = $sliceType($Int);
	sliceType$15 = $sliceType(fieldScan);
	ptrType$10 = $ptrType(structType);
	sliceType$16 = $sliceType($Uint8);
	ptrType$16 = $ptrType($UnsafePointer);
	sliceType$18 = $sliceType($Int32);
	ptrType$17 = $ptrType(funcType);
	funcType$3 = $funcType([$String], [$Bool], false);
	funcType$4 = $funcType([$UnsafePointer, $Uintptr], [$Uintptr], false);
	funcType$5 = $funcType([$UnsafePointer, $UnsafePointer], [$Bool], false);
	arrayType$12 = $arrayType($Uintptr, 2);
	ptrType$18 = $ptrType(ValueError);
	init = function() {
		var $ptr, used, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; used = $f.used; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		used = (function(i) {
			var $ptr, i;
		});
		$r = used((x = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$1 = new uncommonType.ptr(0, 0, 0, 0, 0, sliceType$3.nil), new x$1.constructor.elem(x$1))); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$2 = new method.ptr(0, 0, 0, 0), new x$2.constructor.elem(x$2))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$3 = new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, 0), new x$3.constructor.elem(x$3))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$4 = new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, 0), new x$4.constructor.elem(x$4))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$5 = new funcType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), 0, 0, sliceType$2.nil, sliceType$2.nil), new x$5.constructor.elem(x$5))); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$6 = new interfaceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new name.ptr(ptrType$5.nil), sliceType$7.nil), new x$6.constructor.elem(x$6))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$7 = new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false), new x$7.constructor.elem(x$7))); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$8 = new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil), new x$8.constructor.elem(x$8))); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$9 = new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil), new x$9.constructor.elem(x$9))); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$10 = new structType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new name.ptr(ptrType$5.nil), sliceType$8.nil), new x$10.constructor.elem(x$10))); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$11 = new imethod.ptr(0, 0), new x$11.constructor.elem(x$11))); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$12 = new structField.ptr(new name.ptr(ptrType$5.nil), ptrType$1.nil, 0), new x$12.constructor.elem(x$12))); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = true;
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: init }; } $f.$ptr = $ptr; $f.used = used; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	jsType = function(typ) {
		var $ptr, typ;
		return typ.jsType;
	};
	reflectType = function(typ) {
		var $ptr, _1, _i, _i$1, _i$2, _i$3, _i$4, _key, _ref, _ref$1, _ref$2, _ref$3, _ref$4, dir, f, fields, i, i$1, i$2, i$3, i$4, imethods, in$1, m, m$1, methodSet, methods, out, outCount, params, reflectFields, reflectMethods, results, rt, typ, ut;
		if (typ.reflectType === undefined) {
			rt = new rtype.ptr((($parseInt(typ.size) >> 0) >>> 0), 0, 0, 0, 0, 0, (($parseInt(typ.kind) >> 0) << 24 >>> 24), ptrType$4.nil, ptrType$5.nil, newNameOff(newName(internalStr(typ.string), "", "", !!(typ.exported))), 0);
			rt.jsType = typ;
			typ.reflectType = rt;
			methodSet = $methodSet(typ);
			if (!(($parseInt(methodSet.length) === 0)) || !!(typ.named)) {
				rt.tflag = (rt.tflag | (1)) >>> 0;
				if (!!(typ.named)) {
					rt.tflag = (rt.tflag | (4)) >>> 0;
				}
				reflectMethods = $makeSlice(sliceType$3, $parseInt(methodSet.length));
				_ref = reflectMethods;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i = _i;
					m = methodSet[i];
					method.copy(((i < 0 || i >= reflectMethods.$length) ? $throwRuntimeError("index out of range") : reflectMethods.$array[reflectMethods.$offset + i]), new method.ptr(newNameOff(newName(internalStr(m.name), "", "", internalStr(m.pkg) === "")), newTypeOff(reflectType(m.typ)), 0, 0));
					_i++;
				}
				ut = new uncommonType.ptr(newNameOff(newName(internalStr(typ.pkg), "", "", false)), ($parseInt(methodSet.length) << 16 >>> 16), 0, 0, 0, reflectMethods);
				_key = rt; (uncommonTypeMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: ut };
				ut.jsType = typ;
			}
			_1 = rt.Kind();
			if (_1 === (17)) {
				setKindType(rt, new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem), ptrType$1.nil, (($parseInt(typ.len) >> 0) >>> 0)));
			} else if (_1 === (18)) {
				dir = 3;
				if (!!(typ.sendOnly)) {
					dir = 2;
				}
				if (!!(typ.recvOnly)) {
					dir = 1;
				}
				setKindType(rt, new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem), (dir >>> 0)));
			} else if (_1 === (19)) {
				params = typ.params;
				in$1 = $makeSlice(sliceType$2, $parseInt(params.length));
				_ref$1 = in$1;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					i$1 = _i$1;
					((i$1 < 0 || i$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i$1] = reflectType(params[i$1]));
					_i$1++;
				}
				results = typ.results;
				out = $makeSlice(sliceType$2, $parseInt(results.length));
				_ref$2 = out;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					((i$2 < 0 || i$2 >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i$2] = reflectType(results[i$2]));
					_i$2++;
				}
				outCount = ($parseInt(results.length) << 16 >>> 16);
				if (!!(typ.variadic)) {
					outCount = (outCount | (32768)) >>> 0;
				}
				setKindType(rt, new funcType.ptr($clone(rt, rtype), ($parseInt(params.length) << 16 >>> 16), outCount, in$1, out));
			} else if (_1 === (20)) {
				methods = typ.methods;
				imethods = $makeSlice(sliceType$7, $parseInt(methods.length));
				_ref$3 = imethods;
				_i$3 = 0;
				while (true) {
					if (!(_i$3 < _ref$3.$length)) { break; }
					i$3 = _i$3;
					m$1 = methods[i$3];
					imethod.copy(((i$3 < 0 || i$3 >= imethods.$length) ? $throwRuntimeError("index out of range") : imethods.$array[imethods.$offset + i$3]), new imethod.ptr(newNameOff(newName(internalStr(m$1.name), "", "", internalStr(m$1.pkg) === "")), newTypeOff(reflectType(m$1.typ))));
					_i$3++;
				}
				setKindType(rt, new interfaceType.ptr($clone(rt, rtype), new name.ptr(ptrType$5.nil), imethods));
			} else if (_1 === (21)) {
				setKindType(rt, new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.key), reflectType(typ.elem), ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false));
			} else if (_1 === (22)) {
				setKindType(rt, new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (23)) {
				setKindType(rt, new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (25)) {
				fields = typ.fields;
				reflectFields = $makeSlice(sliceType$8, $parseInt(fields.length));
				_ref$4 = reflectFields;
				_i$4 = 0;
				while (true) {
					if (!(_i$4 < _ref$4.$length)) { break; }
					i$4 = _i$4;
					f = fields[i$4];
					structField.copy(((i$4 < 0 || i$4 >= reflectFields.$length) ? $throwRuntimeError("index out of range") : reflectFields.$array[reflectFields.$offset + i$4]), new structField.ptr($clone(newName(internalStr(f.name), internalStr(f.tag), "", !!(f.exported)), name), reflectType(f.typ), (i$4 >>> 0)));
					_i$4++;
				}
				setKindType(rt, new structType.ptr($clone(rt, rtype), $clone(newName(internalStr(typ.pkgPath), "", "", false), name), reflectFields));
			}
		}
		return typ.reflectType;
	};
	setKindType = function(rt, kindType) {
		var $ptr, kindType, rt;
		rt.kindType = kindType;
		kindType.rtype = rt;
	};
	uncommonType.ptr.prototype.methods = function() {
		var $ptr, t;
		t = this;
		return t._methods;
	};
	uncommonType.prototype.methods = function() { return this.$val.methods(); };
	rtype.ptr.prototype.uncommon = function() {
		var $ptr, _entry, t;
		t = this;
		return (_entry = uncommonTypeMap[ptrType$1.keyFor(t)], _entry !== undefined ? _entry.v : ptrType$6.nil);
	};
	rtype.prototype.uncommon = function() { return this.$val.uncommon(); };
	funcType.ptr.prototype.in$ = function() {
		var $ptr, t;
		t = this;
		return t._in;
	};
	funcType.prototype.in$ = function() { return this.$val.in$(); };
	funcType.ptr.prototype.out = function() {
		var $ptr, t;
		t = this;
		return t._out;
	};
	funcType.prototype.out = function() { return this.$val.out(); };
	name.ptr.prototype.name = function() {
		var $ptr, _entry, n, s;
		s = "";
		n = $clone(this, name);
		s = (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).name;
		return s;
	};
	name.prototype.name = function() { return this.$val.name(); };
	name.ptr.prototype.tag = function() {
		var $ptr, _entry, n, s;
		s = "";
		n = $clone(this, name);
		s = (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).tag;
		return s;
	};
	name.prototype.tag = function() { return this.$val.tag(); };
	name.ptr.prototype.pkgPath = function() {
		var $ptr, _entry, n;
		n = $clone(this, name);
		return (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).pkgPath;
	};
	name.prototype.pkgPath = function() { return this.$val.pkgPath(); };
	name.ptr.prototype.isExported = function() {
		var $ptr, _entry, n;
		n = $clone(this, name);
		return (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).exported;
	};
	name.prototype.isExported = function() { return this.$val.isExported(); };
	newName = function(n, tag, pkgPath, exported) {
		var $ptr, _key, b, exported, n, pkgPath, tag;
		b = $newDataPointer(0, ptrType$5);
		_key = b; (nameMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$5.keyFor(_key)] = { k: _key, v: new nameData.ptr(n, tag, pkgPath, exported) };
		return new name.ptr(b);
	};
	rtype.ptr.prototype.nameOff = function(off) {
		var $ptr, off, t, x;
		t = this;
		return (x = (off >> 0), ((x < 0 || x >= nameOffList.$length) ? $throwRuntimeError("index out of range") : nameOffList.$array[nameOffList.$offset + x]));
	};
	rtype.prototype.nameOff = function(off) { return this.$val.nameOff(off); };
	newNameOff = function(n) {
		var $ptr, i, n;
		n = $clone(n, name);
		i = nameOffList.$length;
		nameOffList = $append(nameOffList, n);
		return (i >> 0);
	};
	rtype.ptr.prototype.typeOff = function(off) {
		var $ptr, off, t, x;
		t = this;
		return (x = (off >> 0), ((x < 0 || x >= typeOffList.$length) ? $throwRuntimeError("index out of range") : typeOffList.$array[typeOffList.$offset + x]));
	};
	rtype.prototype.typeOff = function(off) { return this.$val.typeOff(off); };
	newTypeOff = function(t) {
		var $ptr, i, t;
		i = typeOffList.$length;
		typeOffList = $append(typeOffList, t);
		return (i >> 0);
	};
	internalStr = function(strObj) {
		var $ptr, c, strObj;
		c = new structType$8.ptr("");
		c.str = strObj;
		return c.str;
	};
	isWrapped = function(typ) {
		var $ptr, typ;
		return !!(jsType(typ).wrapped);
	};
	copyStruct = function(dst, src, typ) {
		var $ptr, dst, fields, i, prop, src, typ;
		fields = jsType(typ).fields;
		i = 0;
		while (true) {
			if (!(i < $parseInt(fields.length))) { break; }
			prop = $internalize(fields[i].prop, $String);
			dst[$externalize(prop, $String)] = src[$externalize(prop, $String)];
			i = i + (1) >> 0;
		}
	};
	makeValue = function(t, v, fl) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _v, _v$1, fl, rt, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _v = $f._v; _v$1 = $f._v$1; fl = $f.fl; rt = $f.rt; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rt = _r;
		_r$1 = t.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (_r$1 === 17) { _v$1 = true; $s = 5; continue s; }
		_r$2 = t.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v$1 = _r$2 === 25; case 5:
		if (_v$1) { _v = true; $s = 4; continue s; }
		_r$3 = t.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3 === 22; case 4:
		/* */ if (_v) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_v) { */ case 2:
			_r$4 = t.Kind(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			$s = -1; return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
			return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
		/* } */ case 3:
		_r$5 = t.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeValue }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._v = _v; $f._v$1 = _v$1; $f.fl = fl; $f.rt = rt; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeSlice = function(typ, len, cap) {
		var $ptr, _r, _r$1, cap, len, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; len = $f.len; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		typ = [typ];
		_r = typ[0].Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 23))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 23))) { */ case 1:
			$panic(new $String("reflect.MakeSlice of non-slice type"));
		/* } */ case 2:
		if (len < 0) {
			$panic(new $String("reflect.MakeSlice: negative len"));
		}
		if (cap < 0) {
			$panic(new $String("reflect.MakeSlice: negative cap"));
		}
		if (len > cap) {
			$panic(new $String("reflect.MakeSlice: len > cap"));
		}
		_r$1 = makeValue(typ[0], $makeSlice(jsType(typ[0]), len, cap, (function(typ) { return function $b() {
			var $ptr, _r$1, _r$2, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = typ[0].Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = jsType(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2.zero();
			return _r$2.zero();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.$s = $s; $f.$r = $r; return $f;
		}; })(typ)), 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeSlice }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.len = len; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeSlice = MakeSlice;
	TypeOf = function(i) {
		var $ptr, i;
		if (!initialized) {
			return new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
		}
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return $ifaceNil;
		}
		return reflectType(i.constructor);
	};
	$pkg.TypeOf = TypeOf;
	ValueOf = function(i) {
		var $ptr, _r, i, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(i, $ifaceNil)) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = makeValue(reflectType(i.constructor), i.$val, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ValueOf }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ValueOf = ValueOf;
	FuncOf = function(in$1, out, variadic) {
		var $ptr, _i, _i$1, _r, _ref, _ref$1, _v, _v$1, i, i$1, in$1, jsIn, jsOut, out, v, v$1, variadic, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _v = $f._v; _v$1 = $f._v$1; i = $f.i; i$1 = $f.i$1; in$1 = $f.in$1; jsIn = $f.jsIn; jsOut = $f.jsOut; out = $f.out; v = $f.v; v$1 = $f.v$1; variadic = $f.variadic; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (!(variadic)) { _v = false; $s = 3; continue s; }
		if (in$1.$length === 0) { _v$1 = true; $s = 4; continue s; }
		_r = (x = in$1.$length - 1 >> 0, ((x < 0 || x >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x])).Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v$1 = !((_r === 23)); case 4:
		_v = _v$1; case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect.FuncOf: last arg of variadic func must be slice"));
		/* } */ case 2:
		jsIn = $makeSlice(sliceType$9, in$1.$length);
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= jsIn.$length) ? $throwRuntimeError("index out of range") : jsIn.$array[jsIn.$offset + i] = jsType(v));
			_i++;
		}
		jsOut = $makeSlice(sliceType$9, out.$length);
		_ref$1 = out;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			v$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			((i$1 < 0 || i$1 >= jsOut.$length) ? $throwRuntimeError("index out of range") : jsOut.$array[jsOut.$offset + i$1] = jsType(v$1));
			_i$1++;
		}
		$s = -1; return reflectType($funcType($externalize(jsIn, sliceType$9), $externalize(jsOut, sliceType$9), $externalize(variadic, $Bool)));
		return reflectType($funcType($externalize(jsIn, sliceType$9), $externalize(jsOut, sliceType$9), $externalize(variadic, $Bool)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: FuncOf }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._v = _v; $f._v$1 = _v$1; $f.i = i; $f.i$1 = i$1; $f.in$1 = in$1; $f.jsIn = jsIn; $f.jsOut = jsOut; $f.out = out; $f.v = v; $f.v$1 = v$1; $f.variadic = variadic; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.FuncOf = FuncOf;
	rtype.ptr.prototype.ptrTo = function() {
		var $ptr, t;
		t = this;
		return reflectType($ptrType(jsType(t)));
	};
	rtype.prototype.ptrTo = function() { return this.$val.ptrTo(); };
	SliceOf = function(t) {
		var $ptr, t;
		return reflectType($sliceType(jsType(t)));
	};
	$pkg.SliceOf = SliceOf;
	Zero = function(typ) {
		var $ptr, _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeValue(typ, jsType(typ).zero(), 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Zero }; } $f.$ptr = $ptr; $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Zero = Zero;
	unsafe_New = function(typ) {
		var $ptr, _1, typ;
		_1 = typ.Kind();
		if (_1 === (25)) {
			return new (jsType(typ).ptr)();
		} else if (_1 === (17)) {
			return jsType(typ).zero();
		} else {
			return $newDataPointer(jsType(typ).zero(), jsType(typ.ptrTo()));
		}
	};
	makeInt = function(f, bits, t) {
		var $ptr, _1, _r, bits, f, ptr, t, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; bits = $f.bits; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.Kind();
		if (_1 === (3)) {
			ptr.$set((bits.$low << 24 >> 24));
		} else if (_1 === (4)) {
			ptr.$set((bits.$low << 16 >> 16));
		} else if ((_1 === (2)) || (_1 === (5))) {
			ptr.$set((bits.$low >> 0));
		} else if (_1 === (6)) {
			ptr.$set(new $Int64(bits.$high, bits.$low));
		} else if (_1 === (8)) {
			ptr.$set((bits.$low << 24 >>> 24));
		} else if (_1 === (9)) {
			ptr.$set((bits.$low << 16 >>> 16));
		} else if ((_1 === (7)) || (_1 === (10)) || (_1 === (12))) {
			ptr.$set((bits.$low >>> 0));
		} else if (_1 === (11)) {
			ptr.$set(bits);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeInt }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.bits = bits; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	typedmemmove = function(t, dst, src) {
		var $ptr, dst, src, t;
		dst.$set(src.$get());
	};
	keyFor = function(t, key) {
		var $ptr, k, key, kv, t;
		kv = key;
		if (!(kv.$get === undefined)) {
			kv = kv.$get();
		}
		k = $internalize(jsType(t.Key()).keyFor(kv), $String);
		return [kv, k];
	};
	mapaccess = function(t, m, key) {
		var $ptr, _tuple, entry, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		entry = m[$externalize(k, $String)];
		if (entry === undefined) {
			return 0;
		}
		return $newDataPointer(entry.v, jsType(PtrTo(t.Elem())));
	};
	mapassign = function(t, m, key, val) {
		var $ptr, _r, _tuple, entry, et, jsVal, k, key, kv, m, newVal, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; entry = $f.entry; et = $f.et; jsVal = $f.jsVal; k = $f.k; key = $f.key; kv = $f.kv; m = $f.m; newVal = $f.newVal; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = keyFor(t, key);
		kv = _tuple[0];
		k = _tuple[1];
		jsVal = val.$get();
		et = t.Elem();
		_r = et.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === 25) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === 25) { */ case 1:
			newVal = jsType(et).zero();
			copyStruct(newVal, jsVal, et);
			jsVal = newVal;
		/* } */ case 2:
		entry = new ($global.Object)();
		entry.k = kv;
		entry.v = jsVal;
		m[$externalize(k, $String)] = entry;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapassign }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.entry = entry; $f.et = et; $f.jsVal = jsVal; $f.k = k; $f.key = key; $f.kv = kv; $f.m = m; $f.newVal = newVal; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapdelete = function(t, m, key) {
		var $ptr, _tuple, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		delete m[$externalize(k, $String)];
	};
	mapiterinit = function(t, m) {
		var $ptr, m, t;
		return new mapIter.ptr(t, m, $keys(m), 0);
	};
	mapiterkey = function(it) {
		var $ptr, _r, _r$1, _r$2, it, iter, k, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; it = $f.it; iter = $f.iter; k = $f.k; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		iter = it;
		k = iter.keys[iter.i];
		_r = iter.t.Key(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = PtrTo(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = jsType(_r$1); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapiterkey }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.it = it; $f.iter = iter; $f.k = k; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapiternext = function(it) {
		var $ptr, it, iter;
		iter = it;
		iter.i = iter.i + (1) >> 0;
	};
	maplen = function(m) {
		var $ptr, m;
		return $parseInt($keys(m).length);
	};
	cvtDirect = function(v, typ) {
		var $ptr, _1, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, k, slice, srcVal, typ, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; k = $f.k; slice = $f.slice; srcVal = $f.srcVal; typ = $f.typ; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		srcVal = v.object();
		/* */ if (srcVal === jsType(v.typ).nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (srcVal === jsType(v.typ).nil) { */ case 1:
			_r = makeValue(typ, jsType(typ).nil, v.flag); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
			return _r;
		/* } */ case 2:
		val = null;
			_r$1 = typ.Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			k = _r$1;
			_1 = k;
			/* */ if (_1 === (23)) { $s = 6; continue; }
			/* */ if (_1 === (22)) { $s = 7; continue; }
			/* */ if (_1 === (25)) { $s = 8; continue; }
			/* */ if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_1 === (23)) { */ case 6:
				slice = new (jsType(typ))(srcVal.$array);
				slice.$offset = srcVal.$offset;
				slice.$length = srcVal.$length;
				slice.$capacity = srcVal.$capacity;
				val = $newDataPointer(slice, jsType(PtrTo(typ)));
				$s = 11; continue;
			/* } else if (_1 === (22)) { */ case 7:
				_r$2 = typ.Elem(); /* */ $s = 14; case 14: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$3 = _r$2.Kind(); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 25) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (_r$3 === 25) { */ case 12:
					_r$4 = typ.Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_r$4, v.typ.Elem())) { $s = 16; continue; }
					/* */ $s = 17; continue;
					/* if ($interfaceIsEqual(_r$4, v.typ.Elem())) { */ case 16:
						val = srcVal;
						/* break; */ $s = 4; continue;
					/* } */ case 17:
					val = new (jsType(typ))();
					_arg = val;
					_arg$1 = srcVal;
					_r$5 = typ.Elem(); /* */ $s = 19; case 19: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_arg$2 = _r$5;
					$r = copyStruct(_arg, _arg$1, _arg$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* break; */ $s = 4; continue;
				/* } */ case 13:
				val = new (jsType(typ))(srcVal.$get, srcVal.$set);
				$s = 11; continue;
			/* } else if (_1 === (25)) { */ case 8:
				val = new (jsType(typ).ptr)();
				copyStruct(val, srcVal, typ);
				$s = 11; continue;
			/* } else if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { */ case 9:
				val = v.ptr;
				$s = 11; continue;
			/* } else { */ case 10:
				$panic(new ValueError.ptr("reflect.Convert", k));
			/* } */ case 11:
		case 4:
		_r$6 = typ.common(); /* */ $s = 21; case 21: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_r$7 = typ.Kind(); /* */ $s = 22; case 22: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtDirect }; } $f.$ptr = $ptr; $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f.k = k; $f.slice = slice; $f.srcVal = srcVal; $f.typ = typ; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	methodReceiver = function(op, v, i) {
		var $ptr, _$37, fn, i, m, m$1, op, prop, rcvr, t, tt, ut, v, x, x$1;
		_$37 = ptrType$1.nil;
		t = ptrType$1.nil;
		fn = 0;
		v = v;
		prop = "";
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if (i < 0 || i >= tt.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!tt.rtype.nameOff(m.name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = tt.rtype.typeOff(m.typ);
			prop = tt.rtype.nameOff(m.name).name();
		} else {
			ut = v.typ.uncommon();
			if (ut === ptrType$6.nil || (i >>> 0) >= (ut.mcount >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])), method);
			if (!v.typ.nameOff(m$1.name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = v.typ.typeOff(m$1.mtyp);
			prop = $internalize($methodSet(jsType(v.typ))[i].prop, $String);
		}
		rcvr = v.object();
		if (isWrapped(v.typ)) {
			rcvr = new (jsType(v.typ))(rcvr);
		}
		fn = rcvr[$externalize(prop, $String)];
		return [_$37, t, fn];
	};
	valueInterface = function(v, safe) {
		var $ptr, _r, safe, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; safe = $f.safe; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.Interface", 0));
		}
		if (safe && !((((v.flag & 96) >>> 0) === 0))) {
			$panic(new $String("reflect.Value.Interface: cannot return value obtained from unexported field or method"));
		}
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Interface", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		if (isWrapped(v.typ)) {
			$s = -1; return new (jsType(v.typ))(v.object());
			return new (jsType(v.typ))(v.object());
		}
		$s = -1; return v.object();
		return v.object();
		/* */ } return; } if ($f === undefined) { $f = { $blk: valueInterface }; } $f.$ptr = $ptr; $f._r = _r; $f.safe = safe; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ifaceE2I = function(t, src, dst) {
		var $ptr, dst, src, t;
		dst.$set(src);
	};
	methodName = function() {
		var $ptr;
		return "?FIXME?";
	};
	makeMethodValue = function(op, v) {
		var $ptr, _r, _tuple, fn, fv, op, rcvr, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; fn = $f.fn; fv = $f.fv; op = $f.op; rcvr = $f.rcvr; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fn = [fn];
		rcvr = [rcvr];
		v = v;
		if (((v.flag & 512) >>> 0) === 0) {
			$panic(new $String("reflect: internal error: invalid use of makePartialFunc"));
		}
		_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
		fn[0] = _tuple[2];
		rcvr[0] = v.object();
		if (isWrapped(v.typ)) {
			rcvr[0] = new (jsType(v.typ))(rcvr[0]);
		}
		fv = js.MakeFunc((function(fn, rcvr) { return function(this$1, arguments$1) {
			var $ptr, arguments$1, this$1;
			return new $jsObjectPtr(fn[0].apply(rcvr[0], $externalize(arguments$1, sliceType$9)));
		}; })(fn, rcvr));
		_r = v.Type().common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeMethodValue }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.fn = fn; $f.fv = fv; $f.op = op; $f.rcvr = rcvr; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.ptr.prototype.pointers = function() {
		var $ptr, _1, t;
		t = this;
		_1 = t.Kind();
		if ((_1 === (22)) || (_1 === (21)) || (_1 === (18)) || (_1 === (19)) || (_1 === (25)) || (_1 === (17))) {
			return true;
		} else {
			return false;
		}
	};
	rtype.prototype.pointers = function() { return this.$val.pointers(); };
	rtype.ptr.prototype.Comparable = function() {
		var $ptr, _1, _r, _r$1, _r$2, i, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; i = $f.i; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
			_1 = t.Kind();
			/* */ if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { $s = 2; continue; }
			/* */ if (_1 === (17)) { $s = 3; continue; }
			/* */ if (_1 === (25)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { */ case 2:
				$s = -1; return false;
				return false;
			/* } else if (_1 === (17)) { */ case 3:
				_r = t.Elem().Comparable(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (25)) { */ case 4:
				i = 0;
				/* while (true) { */ case 7:
					/* if (!(i < t.NumField())) { break; } */ if(!(i < t.NumField())) { $s = 8; continue; }
					_r$1 = t.Field(i); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = _r$1.Type.Comparable(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* */ if (!_r$2) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!_r$2) { */ case 9:
						$s = -1; return false;
						return false;
					/* } */ case 10:
					i = i + (1) >> 0;
				/* } */ $s = 7; continue; case 8:
			/* } */ case 5:
		case 1:
		$s = -1; return true;
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Comparable }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.i = i; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Comparable = function() { return this.$val.Comparable(); };
	rtype.ptr.prototype.Method = function(i) {
		var $ptr, _i, _i$1, _r, _r$1, _ref, _ref$1, arg, fl, fn, ft, i, in$1, m, methods, mt, mtyp, out, p, pname, prop, ret, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; arg = $f.arg; fl = $f.fl; fn = $f.fn; ft = $f.ft; i = $f.i; in$1 = $f.in$1; m = $f.m; methods = $f.methods; mt = $f.mt; mtyp = $f.mtyp; out = $f.out; p = $f.p; pname = $f.pname; prop = $f.prop; ret = $f.ret; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		prop = [prop];
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			Method.copy(m, tt.Method(i));
			$s = -1; return m;
			return m;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		methods = _r;
		if (i < 0 || i >= methods.$length) {
			$panic(new $String("reflect: Method index out of range"));
		}
		p = $clone(((i < 0 || i >= methods.$length) ? $throwRuntimeError("index out of range") : methods.$array[methods.$offset + i]), method);
		pname = $clone(t.nameOff(p.name), name);
		m.Name = pname.name();
		fl = 19;
		mtyp = t.typeOff(p.mtyp);
		ft = mtyp.kindType;
		in$1 = $makeSlice(sliceType$11, 0, (1 + ft.in$().$length >> 0));
		in$1 = $append(in$1, t);
		_ref = ft.in$();
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			arg = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			in$1 = $append(in$1, arg);
			_i++;
		}
		out = $makeSlice(sliceType$11, 0, ft.out().$length);
		_ref$1 = ft.out();
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			ret = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			out = $append(out, ret);
			_i$1++;
		}
		_r$1 = FuncOf(in$1, out, ft.rtype.IsVariadic()); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		mt = _r$1;
		m.Type = mt;
		prop[0] = $internalize($methodSet(t.jsType)[i].prop, $String);
		fn = js.MakeFunc((function(prop) { return function(this$1, arguments$1) {
			var $ptr, arguments$1, rcvr, this$1;
			rcvr = (0 >= arguments$1.$length ? $throwRuntimeError("index out of range") : arguments$1.$array[arguments$1.$offset + 0]);
			return new $jsObjectPtr(rcvr[$externalize(prop[0], $String)].apply(rcvr, $externalize($subslice(arguments$1, 1), sliceType$9)));
		}; })(prop));
		m.Func = new Value.ptr($assertType(mt, ptrType$1), fn, fl);
		m.Index = i;
		Method.copy(m, m);
		$s = -1; return m;
		return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Method }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f.arg = arg; $f.fl = fl; $f.fn = fn; $f.ft = ft; $f.i = i; $f.in$1 = in$1; $f.m = m; $f.methods = methods; $f.mt = mt; $f.mtyp = mtyp; $f.out = out; $f.p = p; $f.pname = pname; $f.prop = prop; $f.ret = ret; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.object = function() {
		var $ptr, _1, newVal, v, val;
		v = this;
		if ((v.typ.Kind() === 17) || (v.typ.Kind() === 25)) {
			return v.ptr;
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			val = v.ptr.$get();
			if (!(val === $ifaceNil) && !(val.constructor === jsType(v.typ))) {
				switch (0) { default:
					_1 = v.typ.Kind();
					if ((_1 === (11)) || (_1 === (6))) {
						val = new (jsType(v.typ))(val.$high, val.$low);
					} else if ((_1 === (15)) || (_1 === (16))) {
						val = new (jsType(v.typ))(val.$real, val.$imag);
					} else if (_1 === (23)) {
						if (val === val.constructor.nil) {
							val = jsType(v.typ).nil;
							break;
						}
						newVal = new (jsType(v.typ))(val.$array);
						newVal.$offset = val.$offset;
						newVal.$length = val.$length;
						newVal.$capacity = val.$capacity;
						val = newVal;
					}
				}
			}
			return val;
		}
		return v.ptr;
	};
	Value.prototype.object = function() { return this.$val.object(); };
	Value.ptr.prototype.call = function(op, in$1) {
		var $ptr, _1, _arg, _arg$1, _arg$2, _arg$3, _i, _i$1, _i$2, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tuple, arg, argsArray, elem, fn, i, i$1, i$2, i$3, in$1, isSlice, m, n, nin, nout, op, origIn, rcvr, results, ret, slice, t, targ, v, x, x$1, x$2, xt, xt$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; arg = $f.arg; argsArray = $f.argsArray; elem = $f.elem; fn = $f.fn; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; in$1 = $f.in$1; isSlice = $f.isSlice; m = $f.m; n = $f.n; nin = $f.nin; nout = $f.nout; op = $f.op; origIn = $f.origIn; rcvr = $f.rcvr; results = $f.results; ret = $f.ret; slice = $f.slice; t = $f.t; targ = $f.targ; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; xt = $f.xt; xt$1 = $f.xt$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		t = ptrType$1.nil;
		fn = 0;
		rcvr = null;
		if (!((((v.flag & 512) >>> 0) === 0))) {
			_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
			t = _tuple[1];
			fn = _tuple[2];
			rcvr = v.object();
			if (isWrapped(v.typ)) {
				rcvr = new (jsType(v.typ))(rcvr);
			}
		} else {
			t = v.typ;
			fn = v.object();
			rcvr = undefined;
		}
		if (fn === 0) {
			$panic(new $String("reflect.Value.Call: call of nil function"));
		}
		isSlice = op === "CallSlice";
		n = t.NumIn();
		if (isSlice) {
			if (!t.IsVariadic()) {
				$panic(new $String("reflect: CallSlice of non-variadic function"));
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: CallSlice with too few input arguments"));
			}
			if (in$1.$length > n) {
				$panic(new $String("reflect: CallSlice with too many input arguments"));
			}
		} else {
			if (t.IsVariadic()) {
				n = n - (1) >> 0;
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: Call with too few input arguments"));
			}
			if (!t.IsVariadic() && in$1.$length > n) {
				$panic(new $String("reflect: Call with too many input arguments"));
			}
		}
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (x.Kind() === 0) {
				$panic(new $String("reflect: " + op + " using zero Value argument"));
			}
			_i++;
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_tmp = ((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i]).Type();
			_tmp$1 = t.In(i);
			xt = _tmp;
			targ = _tmp$1;
			_r = xt.AssignableTo(targ); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				_r$1 = xt.String(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = targ.String(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$panic(new $String("reflect: " + op + " using " + _r$1 + " as type " + _r$2));
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!isSlice && t.IsVariadic()) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!isSlice && t.IsVariadic()) { */ case 8:
			m = in$1.$length - n >> 0;
			_r$3 = MakeSlice(t.In(n), m, m); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			slice = _r$3;
			_r$4 = t.In(n).Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			elem = _r$4;
			i$1 = 0;
			/* while (true) { */ case 12:
				/* if (!(i$1 < m)) { break; } */ if(!(i$1 < m)) { $s = 13; continue; }
				x$2 = (x$1 = n + i$1 >> 0, ((x$1 < 0 || x$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x$1]));
				xt$1 = x$2.Type();
				_r$5 = xt$1.AssignableTo(elem); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ if (!_r$5) { $s = 14; continue; }
				/* */ $s = 15; continue;
				/* if (!_r$5) { */ case 14:
					_r$6 = xt$1.String(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_r$7 = elem.String(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					$panic(new $String("reflect: cannot use " + _r$6 + " as type " + _r$7 + " in " + op));
				/* } */ case 15:
				_r$8 = slice.Index(i$1); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				$r = _r$8.Set(x$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i$1 = i$1 + (1) >> 0;
			/* } */ $s = 12; continue; case 13:
			origIn = in$1;
			in$1 = $makeSlice(sliceType$10, (n + 1 >> 0));
			$copySlice($subslice(in$1, 0, n), origIn);
			((n < 0 || n >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + n] = slice);
		/* } */ case 9:
		nin = in$1.$length;
		if (!((nin === t.NumIn()))) {
			$panic(new $String("reflect.Value.Call: wrong argument count"));
		}
		nout = t.NumOut();
		argsArray = new ($global.Array)(t.NumIn());
		_ref$1 = in$1;
		_i$1 = 0;
		/* while (true) { */ case 21:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 22; continue; }
			i$2 = _i$1;
			arg = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			_arg = t.In(i$2);
			_r$9 = t.In(i$2).common(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			_arg$1 = _r$9;
			_arg$2 = 0;
			_r$10 = arg.assignTo("reflect.Value.Call", _arg$1, _arg$2); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			_r$11 = _r$10.object(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			_arg$3 = _r$11;
			_r$12 = unwrapJsObject(_arg, _arg$3); /* */ $s = 26; case 26: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			argsArray[i$2] = _r$12;
			_i$1++;
		/* } */ $s = 21; continue; case 22:
		_r$13 = callHelper(new sliceType$5([new $jsObjectPtr(fn), new $jsObjectPtr(rcvr), new $jsObjectPtr(argsArray)])); /* */ $s = 27; case 27: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
		results = _r$13;
			_1 = nout;
			/* */ if (_1 === (0)) { $s = 29; continue; }
			/* */ if (_1 === (1)) { $s = 30; continue; }
			/* */ $s = 31; continue;
			/* if (_1 === (0)) { */ case 29:
				$s = -1; return sliceType$10.nil;
				return sliceType$10.nil;
			/* } else if (_1 === (1)) { */ case 30:
				_r$14 = makeValue(t.Out(0), wrapJsObject(t.Out(0), results), 0); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				$s = -1; return new sliceType$10([$clone(_r$14, Value)]);
				return new sliceType$10([$clone(_r$14, Value)]);
			/* } else { */ case 31:
				ret = $makeSlice(sliceType$10, nout);
				_ref$2 = ret;
				_i$2 = 0;
				/* while (true) { */ case 34:
					/* if (!(_i$2 < _ref$2.$length)) { break; } */ if(!(_i$2 < _ref$2.$length)) { $s = 35; continue; }
					i$3 = _i$2;
					_r$15 = makeValue(t.Out(i$3), wrapJsObject(t.Out(i$3), results[i$3]), 0); /* */ $s = 36; case 36: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					((i$3 < 0 || i$3 >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i$3] = _r$15);
					_i$2++;
				/* } */ $s = 34; continue; case 35:
				$s = -1; return ret;
				return ret;
			/* } */ case 32:
		case 28:
		$s = -1; return sliceType$10.nil;
		return sliceType$10.nil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.call }; } $f.$ptr = $ptr; $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.arg = arg; $f.argsArray = argsArray; $f.elem = elem; $f.fn = fn; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.in$1 = in$1; $f.isSlice = isSlice; $f.m = m; $f.n = n; $f.nin = nin; $f.nout = nout; $f.op = op; $f.origIn = origIn; $f.rcvr = rcvr; $f.results = results; $f.ret = ret; $f.slice = slice; $f.t = t; $f.targ = targ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.xt = xt; $f.xt$1 = xt$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.call = function(op, in$1) { return this.$val.call(op, in$1); };
	Value.ptr.prototype.Cap = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (17)) {
			return v.typ.Len();
		} else if ((_1 === (18)) || (_1 === (23))) {
			return $parseInt(v.object().$capacity) >> 0;
		}
		$panic(new ValueError.ptr("reflect.Value.Cap", k));
	};
	Value.prototype.Cap = function() { return this.$val.Cap(); };
	wrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return new (jsType(jsObjectPtr))(val);
		}
		return val;
	};
	unwrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return val.object;
		}
		return val;
	};
	Value.ptr.prototype.Elem = function() {
		var $ptr, _1, _r, fl, k, tt, typ, v, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; fl = $f.fl; k = $f.k; tt = $f.tt; typ = $f.typ; v = $f.v; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (20)) { $s = 2; continue; }
			/* */ if (_1 === (22)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_1 === (20)) { */ case 2:
				val = v.object();
				if (val === $ifaceNil) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				typ = reflectType(val.constructor);
				_r = makeValue(typ, val.$val, (v.flag & 96) >>> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (22)) { */ case 3:
				if (v.IsNil()) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				val$1 = v.object();
				tt = v.typ.kindType;
				fl = (((((v.flag & 96) >>> 0) | 128) >>> 0) | 256) >>> 0;
				fl = (fl | ((tt.elem.Kind() >>> 0))) >>> 0;
				$s = -1; return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
				return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
			/* } else { */ case 4:
				$panic(new ValueError.ptr("reflect.Value.Elem", k));
			/* } */ case 5:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Elem }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.fl = fl; $f.k = k; $f.tt = tt; $f.typ = typ; $f.v = v; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Elem = function() { return this.$val.Elem(); };
	Value.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, field, fl, i, jsTag, o, prop, s, tag, tt, typ, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; field = $f.field; fl = $f.fl; i = $f.i; jsTag = $f.jsTag; o = $f.o; prop = $f.prop; s = $f.s; tag = $f.tag; tt = $f.tt; typ = $f.typ; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		jsTag = [jsTag];
		prop = [prop];
		s = [s];
		typ = [typ];
		v = this;
		if (!((new flag(v.flag).kind() === 25))) {
			$panic(new ValueError.ptr("reflect.Value.Field", new flag(v.flag).kind()));
		}
		tt = v.typ.kindType;
		if ((i >>> 0) >= (tt.fields.$length >>> 0)) {
			$panic(new $String("reflect: Field index out of range"));
		}
		prop[0] = $internalize(jsType(v.typ).fields[i].prop, $String);
		field = (x = tt.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		typ[0] = field.typ;
		fl = (((v.flag & 416) >>> 0) | (typ[0].Kind() >>> 0)) >>> 0;
		if (!field.name.isExported()) {
			if (field.name.name() === "") {
				fl = (fl | (64)) >>> 0;
			} else {
				fl = (fl | (32)) >>> 0;
			}
		}
		tag = (x$1 = tt.fields, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])).name.tag();
		/* */ if (!(tag === "") && !((i === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(tag === "") && !((i === 0))) { */ case 1:
			jsTag[0] = getJsTag(tag);
			/* */ if (!(jsTag[0] === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(jsTag[0] === "")) { */ case 3:
				/* while (true) { */ case 5:
					o = [o];
					_r = v.Field(0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					/* */ if (v.typ === jsObjectPtr) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (v.typ === jsObjectPtr) { */ case 8:
						o[0] = v.object().object;
						$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
						return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
					/* } */ case 9:
					/* */ if (v.typ.Kind() === 22) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (v.typ.Kind() === 22) { */ case 10:
						_r$1 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						v = _r$1;
					/* } */ case 11:
				/* } */ $s = 5; continue; case 6:
			/* } */ case 4:
		/* } */ case 2:
		s[0] = v.ptr;
		/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 13:
			$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
			return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
		/* } */ case 14:
		_r$2 = makeValue(typ[0], wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]), fl); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.field = field; $f.fl = fl; $f.i = i; $f.jsTag = jsTag; $f.o = o; $f.prop = prop; $f.s = s; $f.tag = tag; $f.tt = tt; $f.typ = typ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Field = function(i) { return this.$val.Field(i); };
	getJsTag = function(tag) {
		var $ptr, _tuple, i, name$1, qvalue, tag, value;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 32)) && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = $substring(tag, 0, i);
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = $substring(tag, 0, (i + 1 >> 0));
			tag = $substring(tag, (i + 1 >> 0));
			if (name$1 === "js") {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				return value;
			}
		}
		return "";
	};
	Value.ptr.prototype.Index = function(i) {
		var $ptr, _1, _r, _r$1, a, a$1, c, fl, fl$1, fl$2, i, k, s, str, tt, tt$1, typ, typ$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; a = $f.a; a$1 = $f.a$1; c = $f.c; fl = $f.fl; fl$1 = $f.fl$1; fl$2 = $f.fl$2; i = $f.i; k = $f.k; s = $f.s; str = $f.str; tt = $f.tt; tt$1 = $f.tt$1; typ = $f.typ; typ$1 = $f.typ$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		a$1 = [a$1];
		c = [c];
		i = [i];
		typ = [typ];
		typ$1 = [typ$1];
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				tt = v.typ.kindType;
				if (i[0] < 0 || i[0] > (tt.len >> 0)) {
					$panic(new $String("reflect: array index out of range"));
				}
				typ[0] = tt.elem;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((typ[0].Kind() >>> 0))) >>> 0;
				a$1[0] = v.ptr;
				/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 7:
					$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
					return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
				/* } */ case 8:
				_r = makeValue(typ[0], wrapJsObject(typ[0], a$1[0][i[0]]), fl); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (23)) { */ case 3:
				s = v.object();
				if (i[0] < 0 || i[0] >= ($parseInt(s.$length) >> 0)) {
					$panic(new $String("reflect: slice index out of range"));
				}
				tt$1 = v.typ.kindType;
				typ$1[0] = tt$1.elem;
				fl$1 = (384 | ((v.flag & 96) >>> 0)) >>> 0;
				fl$1 = (fl$1 | ((typ$1[0].Kind() >>> 0))) >>> 0;
				i[0] = i[0] + (($parseInt(s.$offset) >> 0)) >> 0;
				a[0] = s.$array;
				/* */ if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { */ case 10:
					$s = -1; return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
					return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
				/* } */ case 11:
				_r$1 = makeValue(typ$1[0], wrapJsObject(typ$1[0], a[0][i[0]]), fl$1); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				$s = -1; return _r$1;
				return _r$1;
			/* } else if (_1 === (24)) { */ case 4:
				str = v.ptr.$get();
				if (i[0] < 0 || i[0] >= str.length) {
					$panic(new $String("reflect: string index out of range"));
				}
				fl$2 = (((v.flag & 96) >>> 0) | 8) >>> 0;
				c[0] = str.charCodeAt(i[0]);
				$s = -1; return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
				return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Index", k));
			/* } */ case 6:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Index }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.a$1 = a$1; $f.c = c; $f.fl = fl; $f.fl$1 = fl$1; $f.fl$2 = fl$2; $f.i = i; $f.k = k; $f.s = s; $f.str = str; $f.tt = tt; $f.tt$1 = tt$1; $f.typ = typ; $f.typ$1 = typ$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Index = function(i) { return this.$val.Index(i); };
	Value.ptr.prototype.InterfaceData = function() {
		var $ptr, v;
		v = this;
		$panic(errors.New("InterfaceData is not supported by GopherJS"));
	};
	Value.prototype.InterfaceData = function() { return this.$val.InterfaceData(); };
	Value.ptr.prototype.IsNil = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (22)) || (_1 === (23))) {
			return v.object() === jsType(v.typ).nil;
		} else if (_1 === (18)) {
			return v.object() === $chanNil;
		} else if (_1 === (19)) {
			return v.object() === $throwNilPointerError;
		} else if (_1 === (21)) {
			return v.object() === false;
		} else if (_1 === (20)) {
			return v.object() === $ifaceNil;
		} else {
			$panic(new ValueError.ptr("reflect.Value.IsNil", k));
		}
	};
	Value.prototype.IsNil = function() { return this.$val.IsNil(); };
	Value.ptr.prototype.Len = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (17)) || (_1 === (24))) {
			return $parseInt(v.object().length);
		} else if (_1 === (23)) {
			return $parseInt(v.object().$length) >> 0;
		} else if (_1 === (18)) {
			return $parseInt(v.object().$buffer.length) >> 0;
		} else if (_1 === (21)) {
			return $parseInt($keys(v.object()).length);
		} else {
			$panic(new ValueError.ptr("reflect.Value.Len", k));
		}
	};
	Value.prototype.Len = function() { return this.$val.Len(); };
	Value.ptr.prototype.Pointer = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (18)) || (_1 === (21)) || (_1 === (22)) || (_1 === (26))) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object();
		} else if (_1 === (19)) {
			if (v.IsNil()) {
				return 0;
			}
			return 1;
		} else if (_1 === (23)) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object().$array;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Pointer", k));
		}
	};
	Value.prototype.Pointer = function() { return this.$val.Pointer(); };
	Value.ptr.prototype.Set = function(x) {
		var $ptr, _1, _r, _r$1, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Set", v.typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		/* */ if (!((((v.flag & 128) >>> 0) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((((v.flag & 128) >>> 0) === 0))) { */ case 2:
				_1 = v.typ.Kind();
				/* */ if (_1 === (17)) { $s = 5; continue; }
				/* */ if (_1 === (20)) { $s = 6; continue; }
				/* */ if (_1 === (25)) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (_1 === (17)) { */ case 5:
					jsType(v.typ).copy(v.ptr, x.ptr);
					$s = 9; continue;
				/* } else if (_1 === (20)) { */ case 6:
					_r$1 = valueInterface(x, false); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					v.ptr.$set(_r$1);
					$s = 9; continue;
				/* } else if (_1 === (25)) { */ case 7:
					copyStruct(v.ptr, x.ptr, v.typ);
					$s = 9; continue;
				/* } else { */ case 8:
					v.ptr.$set(x.object());
				/* } */ case 9:
			case 4:
			$s = -1; return;
			return;
		/* } */ case 3:
		v.ptr = x.ptr;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Set }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Set = function(x) { return this.$val.Set(x); };
	Value.ptr.prototype.SetBytes = function(x) {
		var $ptr, _r, _r$1, _v, slice, typedSlice, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; slice = $f.slice; typedSlice = $f.typedSlice; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.SetBytes of non-byte slice"));
		/* } */ case 2:
		slice = x;
		if (!(v.typ.Name() === "")) { _v = true; $s = 6; continue s; }
		_r$1 = v.typ.Elem().Name(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_v = !(_r$1 === ""); case 6:
		/* */ if (_v) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_v) { */ case 4:
			typedSlice = new (jsType(v.typ))(slice.$array);
			typedSlice.$offset = slice.$offset;
			typedSlice.$length = slice.$length;
			typedSlice.$capacity = slice.$capacity;
			slice = typedSlice;
		/* } */ case 5:
		v.ptr.$set(slice);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.slice = slice; $f.typedSlice = typedSlice; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetBytes = function(x) { return this.$val.SetBytes(x); };
	Value.ptr.prototype.SetCap = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < ($parseInt(s.$length) >> 0) || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice capacity out of range in SetCap"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = s.$length;
		newSlice.$capacity = n;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetCap = function(n) { return this.$val.SetCap(n); };
	Value.ptr.prototype.SetLen = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < 0 || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice length out of range in SetLen"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = n;
		newSlice.$capacity = s.$capacity;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetLen = function(n) { return this.$val.SetLen(n); };
	Value.ptr.prototype.Slice = function(i, j) {
		var $ptr, _1, _r, _r$1, cap, i, j, kind, s, str, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; i = $f.i; j = $f.j; kind = $f.kind; s = $f.s; str = $f.str; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
			kind = new flag(v.flag).kind();
			_1 = kind;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				if (((v.flag & 256) >>> 0) === 0) {
					$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
				}
				tt = v.typ.kindType;
				cap = (tt.len >> 0);
				typ = SliceOf(tt.elem);
				s = new (jsType(typ))(v.object());
				$s = 6; continue;
			/* } else if (_1 === (23)) { */ case 3:
				typ = v.typ;
				s = v.object();
				cap = $parseInt(s.$capacity) >> 0;
				$s = 6; continue;
			/* } else if (_1 === (24)) { */ case 4:
				str = v.ptr.$get();
				if (i < 0 || j < i || j > str.length) {
					$panic(new $String("reflect.Value.Slice: string slice index out of bounds"));
				}
				_r = ValueOf(new $String($substring(str, i, j))); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Slice", kind));
			/* } */ case 6:
		case 1:
		if (i < 0 || j < i || j > cap) {
			$panic(new $String("reflect.Value.Slice: slice index out of bounds"));
		}
		_r$1 = makeValue(typ, $subslice(s, i, j), (v.flag & 96) >>> 0); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.i = i; $f.j = j; $f.kind = kind; $f.s = s; $f.str = str; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice = function(i, j) { return this.$val.Slice(i, j); };
	Value.ptr.prototype.Slice3 = function(i, j, k) {
		var $ptr, _1, _r, cap, i, j, k, kind, s, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; cap = $f.cap; i = $f.i; j = $f.j; k = $f.k; kind = $f.kind; s = $f.s; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
		kind = new flag(v.flag).kind();
		_1 = kind;
		if (_1 === (17)) {
			if (((v.flag & 256) >>> 0) === 0) {
				$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
			}
			tt = v.typ.kindType;
			cap = (tt.len >> 0);
			typ = SliceOf(tt.elem);
			s = new (jsType(typ))(v.object());
		} else if (_1 === (23)) {
			typ = v.typ;
			s = v.object();
			cap = $parseInt(s.$capacity) >> 0;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Slice3", kind));
		}
		if (i < 0 || j < i || k < j || k > cap) {
			$panic(new $String("reflect.Value.Slice3: slice index out of bounds"));
		}
		_r = makeValue(typ, $subslice(s, i, j, k), (v.flag & 96) >>> 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice3 }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.cap = cap; $f.i = i; $f.j = j; $f.k = k; $f.kind = kind; $f.s = s; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice3 = function(i, j, k) { return this.$val.Slice3(i, j, k); };
	Value.ptr.prototype.Close = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		$close(v.object());
	};
	Value.prototype.Close = function() { return this.$val.Close(); };
	chanrecv = function(t, ch, nb, val) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, ch, comms, nb, received, recvRes, selectRes, selected, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; ch = $f.ch; comms = $f.comms; nb = $f.nb; received = $f.received; recvRes = $f.recvRes; selectRes = $f.selectRes; selected = $f.selected; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		received = false;
		comms = new sliceType$12([new sliceType$9([ch])]);
		if (nb) {
			comms = $append(comms, new sliceType$9([]));
		}
		_r = selectHelper(new sliceType$5([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			_tmp = false;
			_tmp$1 = false;
			selected = _tmp;
			received = _tmp$1;
			$s = -1; return [selected, received];
			return [selected, received];
		}
		recvRes = selectRes[1];
		val.$set(recvRes[0]);
		_tmp$2 = true;
		_tmp$3 = !!(recvRes[1]);
		selected = _tmp$2;
		received = _tmp$3;
		$s = -1; return [selected, received];
		return [selected, received];
		/* */ } return; } if ($f === undefined) { $f = { $blk: chanrecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.received = received; $f.recvRes = recvRes; $f.selectRes = selectRes; $f.selected = selected; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	chansend = function(t, ch, val, nb) {
		var $ptr, _r, ch, comms, nb, selectRes, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; ch = $f.ch; comms = $f.comms; nb = $f.nb; selectRes = $f.selectRes; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		comms = new sliceType$12([new sliceType$9([ch, val.$get()])]);
		if (nb) {
			comms = $append(comms, new sliceType$9([]));
		}
		_r = selectHelper(new sliceType$5([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			$s = -1; return false;
			return false;
		}
		$s = -1; return true;
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: chansend }; } $f.$ptr = $ptr; $f._r = _r; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.selectRes = selectRes; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.prototype.String = function() {
		var $ptr, k;
		k = this.$val;
		if ((k >> 0) < kindNames.$length) {
			return ((k < 0 || k >= kindNames.$length) ? $throwRuntimeError("index out of range") : kindNames.$array[kindNames.$offset + k]);
		}
		return "kind" + strconv.Itoa((k >> 0));
	};
	$ptrType(Kind).prototype.String = function() { return new Kind(this.$get()).String(); };
	rtype.ptr.prototype.String = function() {
		var $ptr, s, t;
		t = this;
		s = t.nameOff(t.str).name();
		if (!((((t.tflag & 2) >>> 0) === 0))) {
			return $substring(s, 1);
		}
		return s;
	};
	rtype.prototype.String = function() { return this.$val.String(); };
	rtype.ptr.prototype.Size = function() {
		var $ptr, t;
		t = this;
		return t.size;
	};
	rtype.prototype.Size = function() { return this.$val.Size(); };
	rtype.ptr.prototype.Bits = function() {
		var $ptr, k, t;
		t = this;
		if (t === ptrType$1.nil) {
			$panic(new $String("reflect: Bits of nil Type"));
		}
		k = t.Kind();
		if (k < 2 || k > 16) {
			$panic(new $String("reflect: Bits of non-arithmetic Type " + t.String()));
		}
		return $imul((t.size >> 0), 8);
	};
	rtype.prototype.Bits = function() { return this.$val.Bits(); };
	rtype.ptr.prototype.Align = function() {
		var $ptr, t;
		t = this;
		return (t.align >> 0);
	};
	rtype.prototype.Align = function() { return this.$val.Align(); };
	rtype.ptr.prototype.FieldAlign = function() {
		var $ptr, t;
		t = this;
		return (t.fieldAlign >> 0);
	};
	rtype.prototype.FieldAlign = function() { return this.$val.FieldAlign(); };
	rtype.ptr.prototype.Kind = function() {
		var $ptr, t;
		t = this;
		return (((t.kind & 31) >>> 0) >>> 0);
	};
	rtype.prototype.Kind = function() { return this.$val.Kind(); };
	rtype.ptr.prototype.common = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	rtype.prototype.common = function() { return this.$val.common(); };
	rtype.ptr.prototype.exportedMethods = function() {
		var $ptr, _entry, _i, _i$1, _key, _ref, _ref$1, _tuple, allExported, allm, found, m, m$1, methods, name$1, name$2, t, ut, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _ref = $f._ref; _ref$1 = $f._ref$1; _tuple = $f._tuple; allExported = $f.allExported; allm = $f.allm; found = $f.found; m = $f.m; m$1 = $f.m$1; methods = $f.methods; name$1 = $f.name$1; name$2 = $f.name$2; t = $f.t; ut = $f.ut; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		$r = methodCache.RWMutex.RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tuple = (_entry = methodCache.m[ptrType$1.keyFor(t)], _entry !== undefined ? [_entry.v, true] : [sliceType$3.nil, false]);
		methods = _tuple[0];
		found = _tuple[1];
		$r = methodCache.RWMutex.RUnlock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (found) {
			$s = -1; return methods;
			return methods;
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			$s = -1; return sliceType$3.nil;
			return sliceType$3.nil;
		}
		allm = ut.methods();
		allExported = true;
		_ref = allm;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			m = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), method);
			name$1 = $clone(t.nameOff(m.name), name);
			if (!name$1.isExported()) {
				allExported = false;
				break;
			}
			_i++;
		}
		if (allExported) {
			methods = allm;
		} else {
			methods = $makeSlice(sliceType$3, 0, allm.$length);
			_ref$1 = allm;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				m$1 = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]), method);
				name$2 = $clone(t.nameOff(m$1.name), name);
				if (name$2.isExported()) {
					methods = $append(methods, m$1);
				}
				_i$1++;
			}
			methods = $subslice(methods, 0, methods.$length, methods.$length);
		}
		$r = methodCache.RWMutex.Lock(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (methodCache.m === false) {
			methodCache.m = {};
		}
		_key = t; (methodCache.m || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: methods };
		$r = methodCache.RWMutex.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return methods;
		return methods;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.exportedMethods }; } $f.$ptr = $ptr; $f._entry = _entry; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tuple = _tuple; $f.allExported = allExported; $f.allm = allm; $f.found = found; $f.m = m; $f.m$1 = m$1; $f.methods = methods; $f.name$1 = name$1; $f.name$2 = name$2; $f.t = t; $f.ut = ut; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.exportedMethods = function() { return this.$val.exportedMethods(); };
	rtype.ptr.prototype.NumMethod = function() {
		var $ptr, _r, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			$s = -1; return tt.NumMethod();
			return tt.NumMethod();
		}
		if (((t.tflag & 1) >>> 0) === 0) {
			$s = -1; return 0;
			return 0;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r.$length;
		return _r.$length;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.NumMethod }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	rtype.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, i, m, name$1, ok, p, pname, t, tt, ut, utmethods, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; i = $f.i; m = $f.m; name$1 = $f.name$1; ok = $f.ok; p = $f.p; pname = $f.pname; t = $f.t; tt = $f.tt; ut = $f.ut; utmethods = $f.utmethods; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			_tuple = tt.MethodByName(name$1);
			Method.copy(m, _tuple[0]);
			ok = _tuple[1];
			$s = -1; return [m, ok];
			return [m, ok];
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			_tmp = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
			_tmp$1 = false;
			Method.copy(m, _tmp);
			ok = _tmp$1;
			$s = -1; return [m, ok];
			return [m, ok];
		}
		utmethods = ut.methods();
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (ut.mcount >> 0))) { break; } */ if(!(i < (ut.mcount >> 0))) { $s = 2; continue; }
			p = $clone(((i < 0 || i >= utmethods.$length) ? $throwRuntimeError("index out of range") : utmethods.$array[utmethods.$offset + i]), method);
			pname = $clone(t.nameOff(p.name), name);
			/* */ if (pname.isExported() && pname.name() === name$1) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (pname.isExported() && pname.name() === name$1) { */ case 3:
				_r = t.Method(i); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tmp$2 = $clone(_r, Method);
				_tmp$3 = true;
				Method.copy(m, _tmp$2);
				ok = _tmp$3;
				$s = -1; return [m, ok];
				return [m, ok];
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		_tmp$4 = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		_tmp$5 = false;
		Method.copy(m, _tmp$4);
		ok = _tmp$5;
		$s = -1; return [m, ok];
		return [m, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.MethodByName }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.i = i; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.p = p; $f.pname = pname; $f.t = t; $f.tt = tt; $f.ut = ut; $f.utmethods = utmethods; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	rtype.ptr.prototype.PkgPath = function() {
		var $ptr, t, ut;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			return "";
		}
		return t.nameOff(ut.pkgPath).name();
	};
	rtype.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	rtype.ptr.prototype.Name = function() {
		var $ptr, i, s, t;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		s = t.String();
		i = s.length - 1 >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			if (s.charCodeAt(i) === 46) {
				break;
			}
			i = i - (1) >> 0;
		}
		return $substring(s, (i + 1 >> 0));
	};
	rtype.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.ChanDir = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 18))) {
			$panic(new $String("reflect: ChanDir of non-chan type"));
		}
		tt = t.kindType;
		return (tt.dir >> 0);
	};
	rtype.prototype.ChanDir = function() { return this.$val.ChanDir(); };
	rtype.ptr.prototype.IsVariadic = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: IsVariadic of non-func type"));
		}
		tt = t.kindType;
		return !((((tt.outCount & 32768) >>> 0) === 0));
	};
	rtype.prototype.IsVariadic = function() { return this.$val.IsVariadic(); };
	rtype.ptr.prototype.Elem = function() {
		var $ptr, _1, t, tt, tt$1, tt$2, tt$3, tt$4;
		t = this;
		_1 = t.Kind();
		if (_1 === (17)) {
			tt = t.kindType;
			return toType(tt.elem);
		} else if (_1 === (18)) {
			tt$1 = t.kindType;
			return toType(tt$1.elem);
		} else if (_1 === (21)) {
			tt$2 = t.kindType;
			return toType(tt$2.elem);
		} else if (_1 === (22)) {
			tt$3 = t.kindType;
			return toType(tt$3.elem);
		} else if (_1 === (23)) {
			tt$4 = t.kindType;
			return toType(tt$4.elem);
		}
		$panic(new $String("reflect: Elem of invalid type"));
	};
	rtype.prototype.Elem = function() { return this.$val.Elem(); };
	rtype.ptr.prototype.Field = function(i) {
		var $ptr, _r, i, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: Field of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.Field(i); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Field = function(i) { return this.$val.Field(i); };
	rtype.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _r, index, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; index = $f.index; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByIndex of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByIndex(index); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.index = index; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	rtype.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _r, name$1, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; name$1 = $f.name$1; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByName of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f.name$1 = name$1; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	rtype.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, match, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; match = $f.match; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByNameFunc of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.match = match; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	rtype.ptr.prototype.In = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: In of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.in$(), ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.In = function(i) { return this.$val.In(i); };
	rtype.ptr.prototype.Key = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 21))) {
			$panic(new $String("reflect: Key of non-map type"));
		}
		tt = t.kindType;
		return toType(tt.key);
	};
	rtype.prototype.Key = function() { return this.$val.Key(); };
	rtype.ptr.prototype.Len = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 17))) {
			$panic(new $String("reflect: Len of non-array type"));
		}
		tt = t.kindType;
		return (tt.len >> 0);
	};
	rtype.prototype.Len = function() { return this.$val.Len(); };
	rtype.ptr.prototype.NumField = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: NumField of non-struct type"));
		}
		tt = t.kindType;
		return tt.fields.$length;
	};
	rtype.prototype.NumField = function() { return this.$val.NumField(); };
	rtype.ptr.prototype.NumIn = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumIn of non-func type"));
		}
		tt = t.kindType;
		return (tt.inCount >> 0);
	};
	rtype.prototype.NumIn = function() { return this.$val.NumIn(); };
	rtype.ptr.prototype.NumOut = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumOut of non-func type"));
		}
		tt = t.kindType;
		return tt.out().$length;
	};
	rtype.prototype.NumOut = function() { return this.$val.NumOut(); };
	rtype.ptr.prototype.Out = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: Out of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.out(), ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.Out = function(i) { return this.$val.Out(i); };
	ChanDir.prototype.String = function() {
		var $ptr, _1, d;
		d = this.$val;
		_1 = d;
		if (_1 === (2)) {
			return "chan<-";
		} else if (_1 === (1)) {
			return "<-chan";
		} else if (_1 === (3)) {
			return "chan";
		}
		return "ChanDir" + strconv.Itoa((d >> 0));
	};
	$ptrType(ChanDir).prototype.String = function() { return new ChanDir(this.$get()).String(); };
	interfaceType.ptr.prototype.Method = function(i) {
		var $ptr, i, m, p, pname, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (i < 0 || i >= t.methods.$length) {
			return m;
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		pname = $clone(t.rtype.nameOff(p.name), name);
		m.Name = pname.name();
		if (!pname.isExported()) {
			m.PkgPath = pname.pkgPath();
			if (m.PkgPath === "") {
				m.PkgPath = t.pkgPath.name();
			}
		}
		m.Type = toType(t.rtype.typeOff(p.typ));
		m.Index = i;
		return m;
	};
	interfaceType.prototype.Method = function(i) { return this.$val.Method(i); };
	interfaceType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		return t.methods.$length;
	};
	interfaceType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	interfaceType.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name$1, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$8.nil) {
			return [m, ok];
		}
		p = ptrType$9.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (t.rtype.nameOff(p.name).name() === name$1) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	interfaceType.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	StructTag.prototype.Get = function(key) {
		var $ptr, _tuple, key, tag, v;
		tag = this.$val;
		_tuple = new StructTag(tag).Lookup(key);
		v = _tuple[0];
		return v;
	};
	$ptrType(StructTag).prototype.Get = function(key) { return new StructTag(this.$get()).Get(key); };
	StructTag.prototype.Lookup = function(key) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, err, i, key, name$1, ok, qvalue, tag, value, value$1;
		value = "";
		ok = false;
		tag = this.$val;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && tag.charCodeAt(i) > 32 && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)) && !((tag.charCodeAt(i) === 127)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i === 0) || (i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = $substring(tag, 0, i);
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = $substring(tag, 0, (i + 1 >> 0));
			tag = $substring(tag, (i + 1 >> 0));
			if (key === name$1) {
				_tuple = strconv.Unquote(qvalue);
				value$1 = _tuple[0];
				err = _tuple[1];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					break;
				}
				_tmp = value$1;
				_tmp$1 = true;
				value = _tmp;
				ok = _tmp$1;
				return [value, ok];
			}
		}
		_tmp$2 = "";
		_tmp$3 = false;
		value = _tmp$2;
		ok = _tmp$3;
		return [value, ok];
	};
	$ptrType(StructTag).prototype.Lookup = function(key) { return new StructTag(this.$get()).Lookup(key); };
	structType.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, f, i, name$1, p, t, t$1, tag, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; i = $f.i; name$1 = $f.name$1; p = $f.p; t = $f.t; t$1 = $f.t$1; tag = $f.tag; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		t = this;
		if (i < 0 || i >= t.fields.$length) {
			$panic(new $String("reflect: Field index out of bounds"));
		}
		p = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		f.Type = toType(p.typ);
		name$1 = p.name.name();
		/* */ if (!(name$1 === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name$1 === "")) { */ case 1:
			f.Name = name$1;
			$s = 3; continue;
		/* } else { */ case 2:
			t$1 = f.Type;
			_r = t$1.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === 22) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_r === 22) { */ case 4:
				_r$1 = t$1.Elem(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				t$1 = _r$1;
			/* } */ case 5:
			_r$2 = t$1.Name(); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			f.Name = _r$2;
			f.Anonymous = true;
		/* } */ case 3:
		if (!p.name.isExported()) {
			f.PkgPath = t.pkgPath.name();
		}
		tag = p.name.tag();
		if (!(tag === "")) {
			f.Tag = tag;
		}
		f.Offset = p.offset;
		f.Index = new sliceType$14([i]);
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.i = i; $f.name$1 = name$1; $f.p = p; $f.t = t; $f.t$1 = t$1; $f.tag = tag; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.Field = function(i) { return this.$val.Field(i); };
	structType.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _v, f, ft, i, index, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _v = $f._v; f = $f.f; ft = $f.ft; i = $f.i; index = $f.index; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		t = this;
		f.Type = toType(t.rtype);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i > 0) { */ case 3:
				ft = f.Type;
				_r = ft.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				if (!(_r === 22)) { _v = false; $s = 7; continue s; }
				_r$1 = ft.Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = _r$1.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v = _r$2 === 25; case 7:
				/* */ if (_v) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_v) { */ case 5:
					_r$3 = ft.Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ft = _r$3;
				/* } */ case 6:
				f.Type = ft;
			/* } */ case 4:
			_r$4 = f.Type.Field(x); /* */ $s = 12; case 12: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			StructField.copy(f, _r$4);
			_i++;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._v = _v; $f.f = f; $f.ft = ft; $f.i = i; $f.index = index; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	structType.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _i, _i$1, _key, _key$1, _key$2, _key$3, _r, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, count, current, f, fname, i, index, match, name$1, next, nextCount, ntyp, ok, result, scan, styp, t, t$1, visited, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; count = $f.count; current = $f.current; f = $f.f; fname = $f.fname; i = $f.i; index = $f.index; match = $f.match; name$1 = $f.name$1; next = $f.next; nextCount = $f.nextCount; ntyp = $f.ntyp; ok = $f.ok; result = $f.result; scan = $f.scan; styp = $f.styp; t = $f.t; t$1 = $f.t$1; visited = $f.visited; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		ok = false;
		t = this;
		current = new sliceType$15([]);
		next = new sliceType$15([new fieldScan.ptr(t, sliceType$14.nil)]);
		nextCount = false;
		visited = $makeMap(ptrType$10.keyFor, []);
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			count = nextCount;
			nextCount = false;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				scan = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), fieldScan);
				t$1 = scan.typ;
				/* */ if ((_entry = visited[ptrType$10.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[ptrType$10.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = t$1; (visited || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key)] = { k: _key, v: true };
				_ref$1 = t$1.fields;
				_i$1 = 0;
				/* while (true) { */ case 7:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 8; continue; }
					i = _i$1;
					f = (x = t$1.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
					fname = "";
					ntyp = ptrType$1.nil;
					name$1 = f.name.name();
					/* */ if (!(name$1 === "")) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!(name$1 === "")) { */ case 9:
						fname = name$1;
						$s = 11; continue;
					/* } else { */ case 10:
						ntyp = f.typ;
						/* */ if (ntyp.Kind() === 22) { $s = 12; continue; }
						/* */ $s = 13; continue;
						/* if (ntyp.Kind() === 22) { */ case 12:
							_r = ntyp.Elem().common(); /* */ $s = 14; case 14: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
							ntyp = _r;
						/* } */ case 13:
						fname = ntyp.Name();
					/* } */ case 11:
					_r$1 = match(fname); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (_r$1) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (_r$1) { */ case 15:
						if ((_entry$1 = count[ptrType$10.keyFor(t$1)], _entry$1 !== undefined ? _entry$1.v : 0) > 1 || ok) {
							_tmp$2 = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
							_tmp$3 = false;
							StructField.copy(result, _tmp$2);
							ok = _tmp$3;
							$s = -1; return [result, ok];
							return [result, ok];
						}
						_r$2 = t$1.Field(i); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						StructField.copy(result, _r$2);
						result.Index = sliceType$14.nil;
						result.Index = $appendSlice(result.Index, scan.index);
						result.Index = $append(result.Index, i);
						ok = true;
						_i$1++;
						/* continue; */ $s = 7; continue;
					/* } */ case 16:
					if (ok || ntyp === ptrType$1.nil || !((ntyp.Kind() === 25))) {
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					styp = ntyp.kindType;
					if ((_entry$2 = nextCount[ptrType$10.keyFor(styp)], _entry$2 !== undefined ? _entry$2.v : 0) > 0) {
						_key$1 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$1)] = { k: _key$1, v: 2 };
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					if (nextCount === false) {
						nextCount = $makeMap(ptrType$10.keyFor, []);
					}
					_key$2 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$2)] = { k: _key$2, v: 1 };
					if ((_entry$3 = count[ptrType$10.keyFor(t$1)], _entry$3 !== undefined ? _entry$3.v : 0) > 1) {
						_key$3 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$3)] = { k: _key$3, v: 2 };
					}
					index = sliceType$14.nil;
					index = $appendSlice(index, scan.index);
					index = $append(index, i);
					next = $append(next, new fieldScan.ptr(styp, index));
					_i$1++;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			if (ok) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [result, ok];
		return [result, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.count = count; $f.current = current; $f.f = f; $f.fname = fname; $f.i = i; $f.index = index; $f.match = match; $f.name$1 = name$1; $f.next = next; $f.nextCount = nextCount; $f.ntyp = ntyp; $f.ok = ok; $f.result = result; $f.scan = scan; $f.styp = styp; $f.t = t; $f.t$1 = t$1; $f.visited = visited; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	structType.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _i, _r, _r$1, _ref, _tmp, _tmp$1, _tuple, f, hasAnon, i, name$1, present, t, tf, tfname, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; f = $f.f; hasAnon = $f.hasAnon; i = $f.i; name$1 = $f.name$1; present = $f.present; t = $f.t; tf = $f.tf; tfname = $f.tfname; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name$1 = [name$1];
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		present = false;
		t = this;
		hasAnon = false;
		/* */ if (!(name$1[0] === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name$1[0] === "")) { */ case 1:
			_ref = t.fields;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				i = _i;
				tf = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				tfname = tf.name.name();
				/* */ if (tfname === "") { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (tfname === "") { */ case 5:
					hasAnon = true;
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				/* */ if (tfname === name$1[0]) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (tfname === name$1[0]) { */ case 7:
					_r = t.Field(i); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tmp = $clone(_r, StructField);
					_tmp$1 = true;
					StructField.copy(f, _tmp);
					present = _tmp$1;
					$s = -1; return [f, present];
					return [f, present];
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
		/* } */ case 2:
		if (!hasAnon) {
			$s = -1; return [f, present];
			return [f, present];
		}
		_r$1 = t.FieldByNameFunc((function(name$1) { return function(s) {
			var $ptr, s;
			return s === name$1[0];
		}; })(name$1)); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		StructField.copy(f, _tuple[0]);
		present = _tuple[1];
		$s = -1; return [f, present];
		return [f, present];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.f = f; $f.hasAnon = hasAnon; $f.i = i; $f.name$1 = name$1; $f.present = present; $f.t = t; $f.tf = tf; $f.tfname = tfname; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	PtrTo = function(t) {
		var $ptr, t;
		return $assertType(t, ptrType$1).ptrTo();
	};
	$pkg.PtrTo = PtrTo;
	rtype.ptr.prototype.Implements = function(u) {
		var $ptr, _r, t, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.Implements"));
		}
		_r = u.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 20))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 20))) { */ case 1:
			$panic(new $String("reflect: non-interface type passed to Type.Implements"));
		/* } */ case 2:
		$s = -1; return implements$1($assertType(u, ptrType$1), t);
		return implements$1($assertType(u, ptrType$1), t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Implements }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Implements = function(u) { return this.$val.Implements(u); };
	rtype.ptr.prototype.AssignableTo = function(u) {
		var $ptr, t, u, uu;
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.AssignableTo"));
		}
		uu = $assertType(u, ptrType$1);
		return directlyAssignable(uu, t) || implements$1(uu, t);
	};
	rtype.prototype.AssignableTo = function(u) { return this.$val.AssignableTo(u); };
	rtype.ptr.prototype.ConvertibleTo = function(u) {
		var $ptr, _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.ConvertibleTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = convertOp(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return !(_r === $throwNilPointerError);
		return !(_r === $throwNilPointerError);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.ConvertibleTo }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.ConvertibleTo = function(u) { return this.$val.ConvertibleTo(u); };
	implements$1 = function(T, V) {
		var $ptr, T, V, i, i$1, j, j$1, t, tm, tm$1, v, v$1, vm, vm$1, vmethods, x, x$1, x$2;
		if (!((T.Kind() === 20))) {
			return false;
		}
		t = T.kindType;
		if (t.methods.$length === 0) {
			return true;
		}
		if (V.Kind() === 20) {
			v = V.kindType;
			i = 0;
			j = 0;
			while (true) {
				if (!(j < v.methods.$length)) { break; }
				tm = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				vm = (x$1 = v.methods, ((j < 0 || j >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + j]));
				if (V.nameOff(vm.name).name() === t.rtype.nameOff(tm.name).name() && V.typeOff(vm.typ) === t.rtype.typeOff(tm.typ)) {
					i = i + (1) >> 0;
					if (i >= t.methods.$length) {
						return true;
					}
				}
				j = j + (1) >> 0;
			}
			return false;
		}
		v$1 = V.uncommon();
		if (v$1 === ptrType$6.nil) {
			return false;
		}
		i$1 = 0;
		vmethods = v$1.methods();
		j$1 = 0;
		while (true) {
			if (!(j$1 < (v$1.mcount >> 0))) { break; }
			tm$1 = (x$2 = t.methods, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			vm$1 = $clone(((j$1 < 0 || j$1 >= vmethods.$length) ? $throwRuntimeError("index out of range") : vmethods.$array[vmethods.$offset + j$1]), method);
			if (V.nameOff(vm$1.name).name() === t.rtype.nameOff(tm$1.name).name() && V.typeOff(vm$1.mtyp) === t.rtype.typeOff(tm$1.typ)) {
				i$1 = i$1 + (1) >> 0;
				if (i$1 >= t.methods.$length) {
					return true;
				}
			}
			j$1 = j$1 + (1) >> 0;
		}
		return false;
	};
	directlyAssignable = function(T, V) {
		var $ptr, T, V;
		if (T === V) {
			return true;
		}
		if (!(T.Name() === "") && !(V.Name() === "") || !((T.Kind() === V.Kind()))) {
			return false;
		}
		return haveIdenticalUnderlyingType(T, V);
	};
	haveIdenticalUnderlyingType = function(T, V) {
		var $ptr, T, V, _1, _i, _ref, i, i$1, i$2, kind, t, t$1, t$2, tf, v, v$1, v$2, vf, x, x$1;
		if (T === V) {
			return true;
		}
		kind = T.Kind();
		if (!((kind === V.Kind()))) {
			return false;
		}
		if (1 <= kind && kind <= 16 || (kind === 24) || (kind === 26)) {
			return true;
		}
		_1 = kind;
		if (_1 === (17)) {
			return $interfaceIsEqual(T.Elem(), V.Elem()) && (T.Len() === V.Len());
		} else if (_1 === (18)) {
			if ((V.ChanDir() === 3) && $interfaceIsEqual(T.Elem(), V.Elem())) {
				return true;
			}
			return (V.ChanDir() === T.ChanDir()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_1 === (19)) {
			t = T.kindType;
			v = V.kindType;
			if (!((t.outCount === v.outCount)) || !((t.inCount === v.inCount))) {
				return false;
			}
			i = 0;
			while (true) {
				if (!(i < t.rtype.NumIn())) { break; }
				if (!($interfaceIsEqual(t.rtype.In(i), v.rtype.In(i)))) {
					return false;
				}
				i = i + (1) >> 0;
			}
			i$1 = 0;
			while (true) {
				if (!(i$1 < t.rtype.NumOut())) { break; }
				if (!($interfaceIsEqual(t.rtype.Out(i$1), v.rtype.Out(i$1)))) {
					return false;
				}
				i$1 = i$1 + (1) >> 0;
			}
			return true;
		} else if (_1 === (20)) {
			t$1 = T.kindType;
			v$1 = V.kindType;
			if ((t$1.methods.$length === 0) && (v$1.methods.$length === 0)) {
				return true;
			}
			return false;
		} else if (_1 === (21)) {
			return $interfaceIsEqual(T.Key(), V.Key()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if ((_1 === (22)) || (_1 === (23))) {
			return $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_1 === (25)) {
			t$2 = T.kindType;
			v$2 = V.kindType;
			if (!((t$2.fields.$length === v$2.fields.$length))) {
				return false;
			}
			_ref = t$2.fields;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i$2 = _i;
				tf = (x = t$2.fields, ((i$2 < 0 || i$2 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i$2]));
				vf = (x$1 = v$2.fields, ((i$2 < 0 || i$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i$2]));
				if (!(tf.name.name() === vf.name.name())) {
					return false;
				}
				if (!(tf.typ === vf.typ)) {
					return false;
				}
				if (!(tf.name.tag() === vf.name.tag())) {
					return false;
				}
				if (!((tf.offset === vf.offset))) {
					return false;
				}
				_i++;
			}
			return true;
		}
		return false;
	};
	toType = function(t) {
		var $ptr, t;
		if (t === ptrType$1.nil) {
			return $ifaceNil;
		}
		return t;
	};
	ifaceIndir = function(t) {
		var $ptr, t;
		return ((t.kind & 32) >>> 0) === 0;
	};
	flag.prototype.kind = function() {
		var $ptr, f;
		f = this.$val;
		return (((f & 31) >>> 0) >>> 0);
	};
	$ptrType(flag).prototype.kind = function() { return new flag(this.$get()).kind(); };
	Value.ptr.prototype.pointer = function() {
		var $ptr, v;
		v = this;
		if (!((v.typ.size === 4)) || !v.typ.pointers()) {
			$panic(new $String("can't call pointer on a non-pointer Value"));
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			return v.ptr.$get();
		}
		return v.ptr;
	};
	Value.prototype.pointer = function() { return this.$val.pointer(); };
	ValueError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Kind === 0) {
			return "reflect: call of " + e.Method + " on zero Value";
		}
		return "reflect: call of " + e.Method + " on " + new Kind(e.Kind).String() + " Value";
	};
	ValueError.prototype.Error = function() { return this.$val.Error(); };
	flag.prototype.mustBe = function(expected) {
		var $ptr, expected, f;
		f = this.$val;
		if (!((new flag(f).kind() === expected))) {
			$panic(new ValueError.ptr(methodName(), new flag(f).kind()));
		}
	};
	$ptrType(flag).prototype.mustBe = function(expected) { return new flag(this.$get()).mustBe(expected); };
	flag.prototype.mustBeExported = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
	};
	$ptrType(flag).prototype.mustBeExported = function() { return new flag(this.$get()).mustBeExported(); };
	flag.prototype.mustBeAssignable = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
		if (((f & 256) >>> 0) === 0) {
			$panic(new $String("reflect: " + methodName() + " using unaddressable value"));
		}
	};
	$ptrType(flag).prototype.mustBeAssignable = function() { return new flag(this.$get()).mustBeAssignable(); };
	Value.ptr.prototype.Addr = function() {
		var $ptr, v;
		v = this;
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.Addr of unaddressable value"));
		}
		return new Value.ptr(v.typ.ptrTo(), v.ptr, ((((v.flag & 96) >>> 0)) | 22) >>> 0);
	};
	Value.prototype.Addr = function() { return this.$val.Addr(); };
	Value.ptr.prototype.Bool = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(1);
		return v.ptr.$get();
	};
	Value.prototype.Bool = function() { return this.$val.Bool(); };
	Value.ptr.prototype.Bytes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-byte slice"));
		/* } */ case 2:
		$s = -1; return v.ptr.$get();
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Bytes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Bytes = function() { return this.$val.Bytes(); };
	Value.ptr.prototype.runes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-rune slice"));
		/* } */ case 2:
		$s = -1; return v.ptr.$get();
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.runes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.runes = function() { return this.$val.runes(); };
	Value.ptr.prototype.CanAddr = function() {
		var $ptr, v;
		v = this;
		return !((((v.flag & 256) >>> 0) === 0));
	};
	Value.prototype.CanAddr = function() { return this.$val.CanAddr(); };
	Value.ptr.prototype.CanSet = function() {
		var $ptr, v;
		v = this;
		return ((v.flag & 352) >>> 0) === 256;
	};
	Value.prototype.CanSet = function() { return this.$val.CanSet(); };
	Value.ptr.prototype.Call = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("Call", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Call }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Call = function(in$1) { return this.$val.Call(in$1); };
	Value.ptr.prototype.CallSlice = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("CallSlice", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.CallSlice }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.CallSlice = function(in$1) { return this.$val.CallSlice(in$1); };
	Value.ptr.prototype.Complex = function() {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return (x = v.ptr.$get(), new $Complex128(x.$real, x.$imag));
		} else if (_1 === (16)) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Complex", new flag(v.flag).kind()));
	};
	Value.prototype.Complex = function() { return this.$val.Complex(); };
	Value.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _ref, _v, i, index, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _v = $f._v; i = $f.i; index = $f.index; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (index.$length === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (index.$length === 1) { */ case 1:
			_r = v.Field((0 >= index.$length ? $throwRuntimeError("index out of range") : index.$array[index.$offset + 0])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
			return _r;
		/* } */ case 2:
		new flag(v.flag).mustBe(25);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 4:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 5; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (i > 0) { */ case 6:
				if (!(v.Kind() === 22)) { _v = false; $s = 10; continue s; }
				_r$1 = v.typ.Elem().Kind(); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v = _r$1 === 25; case 10:
				/* */ if (_v) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (_v) { */ case 8:
					if (v.IsNil()) {
						$panic(new $String("reflect: indirection through nil pointer to embedded struct"));
					}
					_r$2 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					v = _r$2;
				/* } */ case 9:
			/* } */ case 7:
			_r$3 = v.Field(x); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
			_i++;
		/* } */ $s = 4; continue; case 5:
		$s = -1; return v;
		return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._v = _v; $f.i = i; $f.index = index; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	Value.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _r, _r$1, _tuple, f, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(25);
		_r = v.typ.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	Value.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, _r$1, _tuple, f, match, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; match = $f.match; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		_r = v.typ.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.match = match; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	Value.ptr.prototype.Float = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return v.ptr.$get();
		} else if (_1 === (14)) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Float", new flag(v.flag).kind()));
	};
	Value.prototype.Float = function() { return this.$val.Float(); };
	Value.ptr.prototype.Int = function() {
		var $ptr, _1, k, p, v;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (2)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (3)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (4)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (5)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (6)) {
			return p.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Int", new flag(v.flag).kind()));
	};
	Value.prototype.Int = function() { return this.$val.Int(); };
	Value.ptr.prototype.CanInterface = function() {
		var $ptr, v;
		v = this;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.CanInterface", 0));
		}
		return ((v.flag & 96) >>> 0) === 0;
	};
	Value.prototype.CanInterface = function() { return this.$val.CanInterface(); };
	Value.ptr.prototype.Interface = function() {
		var $ptr, _r, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = $ifaceNil;
		v = this;
		_r = valueInterface(v, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		$s = -1; return i;
		return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Interface }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Interface = function() { return this.$val.Interface(); };
	Value.ptr.prototype.IsValid = function() {
		var $ptr, v;
		v = this;
		return !((v.flag === 0));
	};
	Value.prototype.IsValid = function() { return this.$val.IsValid(); };
	Value.ptr.prototype.Kind = function() {
		var $ptr, v;
		v = this;
		return new flag(v.flag).kind();
	};
	Value.prototype.Kind = function() { return this.$val.Kind(); };
	Value.ptr.prototype.MapIndex = function(key) {
		var $ptr, _r, c, e, fl, k, key, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; e = $f.e; fl = $f.fl; k = $f.k; key = $f.key; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.MapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		e = mapaccess(v.typ, v.pointer(), k);
		if (e === 0) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		typ = tt.elem;
		fl = ((((v.flag | key.flag) >>> 0)) & 96) >>> 0;
		fl = (fl | ((typ.Kind() >>> 0))) >>> 0;
		if (ifaceIndir(typ)) {
			c = unsafe_New(typ);
			typedmemmove(typ, c, e);
			$s = -1; return new Value.ptr(typ, c, (fl | 128) >>> 0);
			return new Value.ptr(typ, c, (fl | 128) >>> 0);
		} else {
			$s = -1; return new Value.ptr(typ, e.$get(), fl);
			return new Value.ptr(typ, e.$get(), fl);
		}
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.e = e; $f.fl = fl; $f.k = k; $f.key = key; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapIndex = function(key) { return this.$val.MapIndex(key); };
	Value.ptr.prototype.MapKeys = function() {
		var $ptr, _r, a, c, fl, i, it, key, keyType, m, mlen, tt, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; c = $f.c; fl = $f.fl; i = $f.i; it = $f.it; key = $f.key; keyType = $f.keyType; m = $f.m; mlen = $f.mlen; tt = $f.tt; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		keyType = tt.key;
		fl = (((v.flag & 96) >>> 0) | (keyType.Kind() >>> 0)) >>> 0;
		m = v.pointer();
		mlen = 0;
		if (!(m === 0)) {
			mlen = maplen(m);
		}
		it = mapiterinit(v.typ, m);
		a = $makeSlice(sliceType$10, mlen);
		i = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < a.$length)) { break; } */ if(!(i < a.$length)) { $s = 2; continue; }
			_r = mapiterkey(it); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			key = _r;
			if (key === 0) {
				/* break; */ $s = 2; continue;
			}
			if (ifaceIndir(keyType)) {
				c = unsafe_New(keyType);
				typedmemmove(keyType, c, key);
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, c, (fl | 128) >>> 0));
			} else {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, key.$get(), fl));
			}
			mapiternext(it);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return $subslice(a, 0, i);
		return $subslice(a, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapKeys }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.c = c; $f.fl = fl; $f.i = i; $f.it = it; $f.key = key; $f.keyType = keyType; $f.m = m; $f.mlen = mlen; $f.tt = tt; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapKeys = function() { return this.$val.MapKeys(); };
	Value.ptr.prototype.Method = function(i) {
		var $ptr, _r, _v, fl, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _v = $f._v; fl = $f.fl; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.Method", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) { _v = true; $s = 3; continue s; }
		_r = v.typ.NumMethod(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v = (i >>> 0) >= (_r >>> 0); case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect: Method index out of range"));
		/* } */ case 2:
		if ((v.typ.Kind() === 20) && v.IsNil()) {
			$panic(new $String("reflect: Method on nil interface value"));
		}
		fl = (v.flag & 160) >>> 0;
		fl = (fl | (19)) >>> 0;
		fl = (fl | (((((i >>> 0) << 10 >>> 0) | 512) >>> 0))) >>> 0;
		$s = -1; return new Value.ptr(v.typ, v.ptr, fl);
		return new Value.ptr(v.typ, v.ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Method }; } $f.$ptr = $ptr; $f._r = _r; $f._v = _v; $f.fl = fl; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.NumMethod = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.NumMethod", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return 0;
			return 0;
		}
		_r = v.typ.NumMethod(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.NumMethod }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	Value.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _r, _r$1, _tuple, m, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; m = $f.m; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.MethodByName", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = v.typ.MethodByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		m = $clone(_tuple[0], Method);
		ok = _tuple[1];
		if (!ok) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r$1 = v.Method(m.Index); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MethodByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	Value.ptr.prototype.NumField = function() {
		var $ptr, tt, v;
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		return tt.fields.$length;
	};
	Value.prototype.NumField = function() { return this.$val.NumField(); };
	Value.ptr.prototype.OverflowComplex = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return overflowFloat32(x.$real) || overflowFloat32(x.$imag);
		} else if (_1 === (16)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowComplex", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowComplex = function(x) { return this.$val.OverflowComplex(x); };
	Value.ptr.prototype.OverflowFloat = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return overflowFloat32(x);
		} else if (_1 === (14)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowFloat", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowFloat = function(x) { return this.$val.OverflowFloat(x); };
	overflowFloat32 = function(x) {
		var $ptr, x;
		if (x < 0) {
			x = -x;
		}
		return 3.4028234663852886e+38 < x && x <= 1.7976931348623157e+308;
	};
	Value.ptr.prototype.OverflowInt = function(x) {
		var $ptr, _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightInt64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowInt", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowInt = function(x) { return this.$val.OverflowInt(x); };
	Value.ptr.prototype.OverflowUint = function(x) {
		var $ptr, _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (7)) || (_1 === (12)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightUint64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowUint", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowUint = function(x) { return this.$val.OverflowUint(x); };
	Value.ptr.prototype.Recv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Recv = function() { return this.$val.Recv(); };
	Value.ptr.prototype.recv = function(nb) {
		var $ptr, _r, _tuple, nb, ok, p, selected, t, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; nb = $f.nb; ok = $f.ok; p = $f.p; selected = $f.selected; t = $f.t; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 1) === 0) {
			$panic(new $String("reflect: recv on send-only channel"));
		}
		t = tt.elem;
		val = new Value.ptr(t, 0, (t.Kind() >>> 0));
		p = 0;
		if (ifaceIndir(t)) {
			p = unsafe_New(t);
			val.ptr = p;
			val.flag = (val.flag | (128)) >>> 0;
		} else {
			p = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		_r = chanrecv(v.typ, v.pointer(), nb, p); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		selected = _tuple[0];
		ok = _tuple[1];
		if (!selected) {
			val = new Value.ptr(ptrType$1.nil, 0, 0);
		}
		$s = -1; return [val, ok];
		return [val, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.nb = nb; $f.ok = ok; $f.p = p; $f.selected = selected; $f.t = t; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.recv = function(nb) { return this.$val.recv(nb); };
	Value.ptr.prototype.Send = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Send }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Send = function(x) { return this.$val.Send(x); };
	Value.ptr.prototype.send = function(x, nb) {
		var $ptr, _r, _r$1, nb, p, selected, tt, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; nb = $f.nb; p = $f.p; selected = $f.selected; tt = $f.tt; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		x = x;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 2) === 0) {
			$panic(new $String("reflect: send on recv-only channel"));
		}
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Value.Send", tt.elem, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		p = 0;
		if (!((((x.flag & 128) >>> 0) === 0))) {
			p = x.ptr;
		} else {
			p = (x.$ptr_ptr || (x.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, x)));
		}
		_r$1 = chansend(v.typ, v.pointer(), p, nb); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		selected = _r$1;
		$s = -1; return selected;
		return selected;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.send }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.nb = nb; $f.p = p; $f.selected = selected; $f.tt = tt; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.send = function(x, nb) { return this.$val.send(x, nb); };
	Value.ptr.prototype.SetBool = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(1);
		v.ptr.$set(x);
	};
	Value.prototype.SetBool = function(x) { return this.$val.SetBool(x); };
	Value.ptr.prototype.setRunes = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.setRunes of non-rune slice"));
		/* } */ case 2:
		v.ptr.$set(x);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.setRunes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.setRunes = function(x) { return this.$val.setRunes(x); };
	Value.ptr.prototype.SetComplex = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			v.ptr.$set(new $Complex64(x.$real, x.$imag));
		} else if (_1 === (16)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetComplex", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetComplex = function(x) { return this.$val.SetComplex(x); };
	Value.ptr.prototype.SetFloat = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			v.ptr.$set($fround(x));
		} else if (_1 === (14)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetFloat", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetFloat = function(x) { return this.$val.SetFloat(x); };
	Value.ptr.prototype.SetInt = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (2)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_1 === (3)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 24 >> 24));
		} else if (_1 === (4)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 16 >> 16));
		} else if (_1 === (5)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_1 === (6)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetInt", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetInt = function(x) { return this.$val.SetInt(x); };
	Value.ptr.prototype.SetMapIndex = function(key, val) {
		var $ptr, _r, _r$1, e, k, key, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; e = $f.e; k = $f.k; key = $f.key; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = val;
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		new flag(v.flag).mustBeExported();
		new flag(key.flag).mustBeExported();
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.SetMapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		if (val.typ === ptrType$1.nil) {
			mapdelete(v.typ, v.pointer(), k);
			$s = -1; return;
			return;
		}
		new flag(val.flag).mustBeExported();
		_r$1 = val.assignTo("reflect.Value.SetMapIndex", tt.elem, 0); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		val = _r$1;
		e = 0;
		if (!((((val.flag & 128) >>> 0) === 0))) {
			e = val.ptr;
		} else {
			e = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		$r = mapassign(v.typ, v.pointer(), k, e); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetMapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.e = e; $f.k = k; $f.key = key; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetMapIndex = function(key, val) { return this.$val.SetMapIndex(key, val); };
	Value.ptr.prototype.SetUint = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (7)) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_1 === (8)) {
			v.ptr.$set((x.$low << 24 >>> 24));
		} else if (_1 === (9)) {
			v.ptr.$set((x.$low << 16 >>> 16));
		} else if (_1 === (10)) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_1 === (11)) {
			v.ptr.$set(x);
		} else if (_1 === (12)) {
			v.ptr.$set((x.$low >>> 0));
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetUint", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetUint = function(x) { return this.$val.SetUint(x); };
	Value.ptr.prototype.SetPointer = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(26);
		v.ptr.$set(x);
	};
	Value.prototype.SetPointer = function(x) { return this.$val.SetPointer(x); };
	Value.ptr.prototype.SetString = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(24);
		v.ptr.$set(x);
	};
	Value.prototype.SetString = function(x) { return this.$val.SetString(x); };
	Value.ptr.prototype.String = function() {
		var $ptr, _1, _r, k, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; k = $f.k; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (0)) {
			$s = -1; return "<invalid Value>";
			return "<invalid Value>";
		} else if (_1 === (24)) {
			$s = -1; return v.ptr.$get();
			return v.ptr.$get();
		}
		_r = v.Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return "<" + _r + " Value>";
		return "<" + _r + " Value>";
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.String }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.k = k; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.String = function() { return this.$val.String(); };
	Value.ptr.prototype.TryRecv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TryRecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TryRecv = function() { return this.$val.TryRecv(); };
	Value.ptr.prototype.TrySend = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TrySend }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TrySend = function(x) { return this.$val.TrySend(x); };
	Value.ptr.prototype.Type = function() {
		var $ptr, f, i, m, m$1, tt, ut, v, x, x$1;
		v = this;
		f = v.flag;
		if (f === 0) {
			$panic(new ValueError.ptr("reflect.Value.Type", 0));
		}
		if (((f & 512) >>> 0) === 0) {
			return v.typ;
		}
		i = (v.flag >> 0) >> 10 >> 0;
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if ((i >>> 0) >= (tt.methods.$length >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			return v.typ.typeOff(m.typ);
		}
		ut = v.typ.uncommon();
		if (ut === ptrType$6.nil || (i >>> 0) >= (ut.mcount >>> 0)) {
			$panic(new $String("reflect: internal error: invalid method index"));
		}
		m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])), method);
		return v.typ.typeOff(m$1.mtyp);
	};
	Value.prototype.Type = function() { return this.$val.Type(); };
	Value.ptr.prototype.Uint = function() {
		var $ptr, _1, k, p, v, x;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (7)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (8)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (9)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (10)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (11)) {
			return p.$get();
		} else if (_1 === (12)) {
			return (x = p.$get(), new $Uint64(0, x.constructor === Number ? x : 1));
		}
		$panic(new ValueError.ptr("reflect.Value.Uint", new flag(v.flag).kind()));
	};
	Value.prototype.Uint = function() { return this.$val.Uint(); };
	Value.ptr.prototype.UnsafeAddr = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.UnsafeAddr", 0));
		}
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.UnsafeAddr of unaddressable value"));
		}
		return v.ptr;
	};
	Value.prototype.UnsafeAddr = function() { return this.$val.UnsafeAddr(); };
	New = function(typ) {
		var $ptr, _r, _r$1, fl, ptr, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; fl = $f.fl; ptr = $f.ptr; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(typ, $ifaceNil)) {
			$panic(new $String("reflect: New(nil)"));
		}
		ptr = unsafe_New($assertType(typ, ptrType$1));
		fl = 22;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.ptrTo(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$1, ptr, fl);
		return new Value.ptr(_r$1, ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: New }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.fl = fl; $f.ptr = ptr; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.New = New;
	Value.ptr.prototype.assignTo = function(context, dst, target) {
		var $ptr, _r, _r$1, _r$2, context, dst, fl, target, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; context = $f.context; dst = $f.dst; fl = $f.fl; target = $f.target; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue(context, v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
			/* */ if (directlyAssignable(dst, v.typ)) { $s = 5; continue; }
			/* */ if (implements$1(dst, v.typ)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (directlyAssignable(dst, v.typ)) { */ case 5:
				v.typ = dst;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((dst.Kind() >>> 0))) >>> 0;
				$s = -1; return new Value.ptr(dst, v.ptr, fl);
				return new Value.ptr(dst, v.ptr, fl);
			/* } else if (implements$1(dst, v.typ)) { */ case 6:
				if (target === 0) {
					target = unsafe_New(dst);
				}
				_r$1 = valueInterface(v, false); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				x = _r$1;
				_r$2 = dst.NumMethod(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				/* */ if (_r$2 === 0) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_r$2 === 0) { */ case 9:
					target.$set(x);
					$s = 11; continue;
				/* } else { */ case 10:
					ifaceE2I(dst, x, target);
				/* } */ case 11:
				$s = -1; return new Value.ptr(dst, target, 148);
				return new Value.ptr(dst, target, 148);
			/* } */ case 7:
		case 4:
		$panic(new $String(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String()));
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.assignTo }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.context = context; $f.dst = dst; $f.fl = fl; $f.target = target; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.assignTo = function(context, dst, target) { return this.$val.assignTo(context, dst, target); };
	Value.ptr.prototype.Convert = function(t) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, op, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; op = $f.op; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Convert", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		_r$1 = t.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = convertOp(_r$1, v.typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		/* */ if (op === $throwNilPointerError) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (op === $throwNilPointerError) { */ case 6:
			_r$3 = t.String(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$panic(new $String("reflect.Value.Convert: value of type " + v.typ.String() + " cannot be converted to type " + _r$3));
		/* } */ case 7:
		_r$4 = op(v, t); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return _r$4;
		return _r$4;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Convert }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.op = op; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Convert = function(t) { return this.$val.Convert(t); };
	convertOp = function(dst, src) {
		var $ptr, _1, _2, _3, _4, _5, _6, _7, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _v, _v$1, _v$2, dst, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _5 = $f._5; _6 = $f._6; _7 = $f._7; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; dst = $f.dst; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = src.Kind();
			/* */ if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { $s = 2; continue; }
			/* */ if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { $s = 3; continue; }
			/* */ if ((_1 === (13)) || (_1 === (14))) { $s = 4; continue; }
			/* */ if ((_1 === (15)) || (_1 === (16))) { $s = 5; continue; }
			/* */ if (_1 === (24)) { $s = 6; continue; }
			/* */ if (_1 === (23)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { */ case 2:
				_2 = dst.Kind();
				if ((_2 === (2)) || (_2 === (3)) || (_2 === (4)) || (_2 === (5)) || (_2 === (6)) || (_2 === (7)) || (_2 === (8)) || (_2 === (9)) || (_2 === (10)) || (_2 === (11)) || (_2 === (12))) {
					$s = -1; return cvtInt;
					return cvtInt;
				} else if ((_2 === (13)) || (_2 === (14))) {
					$s = -1; return cvtIntFloat;
					return cvtIntFloat;
				} else if (_2 === (24)) {
					$s = -1; return cvtIntString;
					return cvtIntString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { */ case 3:
				_3 = dst.Kind();
				if ((_3 === (2)) || (_3 === (3)) || (_3 === (4)) || (_3 === (5)) || (_3 === (6)) || (_3 === (7)) || (_3 === (8)) || (_3 === (9)) || (_3 === (10)) || (_3 === (11)) || (_3 === (12))) {
					$s = -1; return cvtUint;
					return cvtUint;
				} else if ((_3 === (13)) || (_3 === (14))) {
					$s = -1; return cvtUintFloat;
					return cvtUintFloat;
				} else if (_3 === (24)) {
					$s = -1; return cvtUintString;
					return cvtUintString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (13)) || (_1 === (14))) { */ case 4:
				_4 = dst.Kind();
				if ((_4 === (2)) || (_4 === (3)) || (_4 === (4)) || (_4 === (5)) || (_4 === (6))) {
					$s = -1; return cvtFloatInt;
					return cvtFloatInt;
				} else if ((_4 === (7)) || (_4 === (8)) || (_4 === (9)) || (_4 === (10)) || (_4 === (11)) || (_4 === (12))) {
					$s = -1; return cvtFloatUint;
					return cvtFloatUint;
				} else if ((_4 === (13)) || (_4 === (14))) {
					$s = -1; return cvtFloat;
					return cvtFloat;
				}
				$s = 8; continue;
			/* } else if ((_1 === (15)) || (_1 === (16))) { */ case 5:
				_5 = dst.Kind();
				if ((_5 === (15)) || (_5 === (16))) {
					$s = -1; return cvtComplex;
					return cvtComplex;
				}
				$s = 8; continue;
			/* } else if (_1 === (24)) { */ case 6:
				if (!(dst.Kind() === 23)) { _v = false; $s = 11; continue s; }
				_r = dst.Elem().PkgPath(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r === ""; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
						_r$1 = dst.Elem().Kind(); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						_6 = _r$1;
						if (_6 === (8)) {
							$s = -1; return cvtStringBytes;
							return cvtStringBytes;
						} else if (_6 === (5)) {
							$s = -1; return cvtStringRunes;
							return cvtStringRunes;
						}
					case 13:
				/* } */ case 10:
				$s = 8; continue;
			/* } else if (_1 === (23)) { */ case 7:
				if (!(dst.Kind() === 24)) { _v$1 = false; $s = 17; continue s; }
				_r$2 = src.Elem().PkgPath(); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$1 = _r$2 === ""; case 17:
				/* */ if (_v$1) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_v$1) { */ case 15:
						_r$3 = src.Elem().Kind(); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_7 = _r$3;
						if (_7 === (8)) {
							$s = -1; return cvtBytesString;
							return cvtBytesString;
						} else if (_7 === (5)) {
							$s = -1; return cvtRunesString;
							return cvtRunesString;
						}
					case 19:
				/* } */ case 16:
			/* } */ case 8:
		case 1:
		if (haveIdenticalUnderlyingType(dst, src)) {
			$s = -1; return cvtDirect;
			return cvtDirect;
		}
		if (!((dst.Kind() === 22) && dst.Name() === "" && (src.Kind() === 22) && src.Name() === "")) { _v$2 = false; $s = 23; continue s; }
		_r$4 = dst.Elem().common(); /* */ $s = 24; case 24: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_arg = _r$4;
		_r$5 = src.Elem().common(); /* */ $s = 25; case 25: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg$1 = _r$5;
		_r$6 = haveIdenticalUnderlyingType(_arg, _arg$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_v$2 = _r$6; case 23:
		/* */ if (_v$2) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (_v$2) { */ case 21:
			$s = -1; return cvtDirect;
			return cvtDirect;
		/* } */ case 22:
		if (implements$1(dst, src)) {
			if (src.Kind() === 20) {
				$s = -1; return cvtI2I;
				return cvtI2I;
			}
			$s = -1; return cvtT2I;
			return cvtT2I;
		}
		$s = -1; return $throwNilPointerError;
		return $throwNilPointerError;
		/* */ } return; } if ($f === undefined) { $f = { $blk: convertOp }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._5 = _5; $f._6 = _6; $f._7 = _7; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.dst = dst; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeFloat = function(f, v, t) {
		var $ptr, _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (4)) {
			ptr.$set($fround(v));
		} else if (_1 === (8)) {
			ptr.$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeFloat }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeComplex = function(f, v, t) {
		var $ptr, _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (8)) {
			ptr.$set(new $Complex64(v.$real, v.$imag));
		} else if (_1 === (16)) {
			ptr.$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeComplex }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeString = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		ret.SetString(v);
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeString }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeBytes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.SetBytes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeRunes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.setRunes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeRunes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = v.Int(), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, v.Uint(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = new $Int64(0, v.Float()), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, new $Uint64(0, v.Float()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Int()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Uint()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, v.Float(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtComplex = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeComplex((v.flag & 96) >>> 0, v.Complex(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtComplex }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Int().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Uint().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtBytesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.Bytes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $bytesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtBytesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringBytes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$16($stringToBytes(_r));
		_arg$2 = t;
		_r$1 = makeBytes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringBytes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtRunesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.runes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $runesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtRunesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringRunes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$18($stringToRunes(_r));
		_arg$2 = t;
		_r$1 = makeRunes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringRunes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtT2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, target, typ, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; target = $f.target; typ = $f.typ; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = unsafe_New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		target = _r$1;
		_r$2 = valueInterface(v, false); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		x = _r$2;
		_r$3 = typ.NumMethod(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 0) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_r$3 === 0) { */ case 4:
			target.$set(x);
			$s = 6; continue;
		/* } else { */ case 5:
			ifaceE2I($assertType(typ, ptrType$1), x, target);
		/* } */ case 6:
		_r$4 = typ.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtT2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.target = target; $f.typ = typ; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtI2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, ret, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; ret = $f.ret; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		/* */ if (v.IsNil()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (v.IsNil()) { */ case 1:
			_r = Zero(typ); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			ret = _r;
			ret.flag = (ret.flag | (((v.flag & 96) >>> 0))) >>> 0;
			$s = -1; return ret;
			return ret;
		/* } */ case 2:
		_r$1 = v.Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = cvtT2I(_r$1, typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtI2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.ret = ret; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ptrType$6.methods = [{prop: "methods", name: "methods", pkg: "reflect", typ: $funcType([], [sliceType$3], false)}];
	ptrType$17.methods = [{prop: "in$", name: "in", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}, {prop: "out", name: "out", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}];
	name.methods = [{prop: "name", name: "name", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "tag", name: "tag", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "isExported", name: "isExported", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "data", name: "data", pkg: "reflect", typ: $funcType([$Int], [ptrType$5], false)}, {prop: "nameLen", name: "nameLen", pkg: "reflect", typ: $funcType([], [$Int], false)}, {prop: "tagLen", name: "tagLen", pkg: "reflect", typ: $funcType([], [$Int], false)}];
	Kind.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$6], false)}, {prop: "nameOff", name: "nameOff", pkg: "reflect", typ: $funcType([nameOff], [name], false)}, {prop: "typeOff", name: "typeOff", pkg: "reflect", typ: $funcType([typeOff], [ptrType$1], false)}, {prop: "ptrTo", name: "ptrTo", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "pointers", name: "pointers", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "textOff", name: "textOff", pkg: "reflect", typ: $funcType([textOff], [$UnsafePointer], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "exportedMethods", name: "exportedMethods", pkg: "reflect", typ: $funcType([], [sliceType$3], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}];
	ChanDir.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$8.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ptrType$10.methods = [{prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}];
	StructTag.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Lookup", name: "Lookup", pkg: "", typ: $funcType([$String], [$String, $Bool], false)}];
	Value.methods = [{prop: "object", name: "object", pkg: "reflect", typ: $funcType([], [ptrType$3], false)}, {prop: "call", name: "call", pkg: "reflect", typ: $funcType([$String, sliceType$10], [sliceType$10], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "InterfaceData", name: "InterfaceData", pkg: "", typ: $funcType([], [arrayType$12], false)}, {prop: "IsNil", name: "IsNil", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Pointer", name: "Pointer", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([Value], [], false)}, {prop: "SetBytes", name: "SetBytes", pkg: "", typ: $funcType([sliceType$16], [], false)}, {prop: "SetCap", name: "SetCap", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "SetLen", name: "SetLen", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([$Int, $Int], [Value], false)}, {prop: "Slice3", name: "Slice3", pkg: "", typ: $funcType([$Int, $Int, $Int], [Value], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "pointer", name: "pointer", pkg: "reflect", typ: $funcType([], [$UnsafePointer], false)}, {prop: "Addr", name: "Addr", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "runes", name: "runes", pkg: "reflect", typ: $funcType([], [sliceType$18], false)}, {prop: "CanAddr", name: "CanAddr", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CanSet", name: "CanSet", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([sliceType$10], [sliceType$10], false)}, {prop: "CallSlice", name: "CallSlice", pkg: "", typ: $funcType([sliceType$10], [sliceType$10], false)}, {prop: "Complex", name: "Complex", pkg: "", typ: $funcType([], [$Complex128], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [Value], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [Value], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "CanInterface", name: "CanInterface", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "IsValid", name: "IsValid", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "MapIndex", name: "MapIndex", pkg: "", typ: $funcType([Value], [Value], false)}, {prop: "MapKeys", name: "MapKeys", pkg: "", typ: $funcType([], [sliceType$10], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OverflowComplex", name: "OverflowComplex", pkg: "", typ: $funcType([$Complex128], [$Bool], false)}, {prop: "OverflowFloat", name: "OverflowFloat", pkg: "", typ: $funcType([$Float64], [$Bool], false)}, {prop: "OverflowInt", name: "OverflowInt", pkg: "", typ: $funcType([$Int64], [$Bool], false)}, {prop: "OverflowUint", name: "OverflowUint", pkg: "", typ: $funcType([$Uint64], [$Bool], false)}, {prop: "Recv", name: "Recv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "recv", name: "recv", pkg: "reflect", typ: $funcType([$Bool], [Value, $Bool], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([Value], [], false)}, {prop: "send", name: "send", pkg: "reflect", typ: $funcType([Value, $Bool], [$Bool], false)}, {prop: "SetBool", name: "SetBool", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "setRunes", name: "setRunes", pkg: "reflect", typ: $funcType([sliceType$18], [], false)}, {prop: "SetComplex", name: "SetComplex", pkg: "", typ: $funcType([$Complex128], [], false)}, {prop: "SetFloat", name: "SetFloat", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "SetInt", name: "SetInt", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "SetMapIndex", name: "SetMapIndex", pkg: "", typ: $funcType([Value, Value], [], false)}, {prop: "SetUint", name: "SetUint", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "SetPointer", name: "SetPointer", pkg: "", typ: $funcType([$UnsafePointer], [], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TryRecv", name: "TryRecv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "TrySend", name: "TrySend", pkg: "", typ: $funcType([Value], [$Bool], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Uint", name: "Uint", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "UnsafeAddr", name: "UnsafeAddr", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "assignTo", name: "assignTo", pkg: "reflect", typ: $funcType([$String, ptrType$1, $UnsafePointer], [Value], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Type], [Value], false)}];
	flag.methods = [{prop: "kind", name: "kind", pkg: "reflect", typ: $funcType([], [Kind], false)}, {prop: "mustBe", name: "mustBe", pkg: "reflect", typ: $funcType([Kind], [], false)}, {prop: "mustBeExported", name: "mustBeExported", pkg: "reflect", typ: $funcType([], [], false)}, {prop: "mustBeAssignable", name: "mustBeAssignable", pkg: "reflect", typ: $funcType([], [], false)}];
	ptrType$18.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	uncommonType.init("reflect", [{prop: "pkgPath", name: "pkgPath", exported: false, typ: nameOff, tag: ""}, {prop: "mcount", name: "mcount", exported: false, typ: $Uint16, tag: ""}, {prop: "_$2", name: "_", exported: false, typ: $Uint16, tag: ""}, {prop: "moff", name: "moff", exported: false, typ: $Uint32, tag: ""}, {prop: "_$4", name: "_", exported: false, typ: $Uint32, tag: ""}, {prop: "_methods", name: "_methods", exported: false, typ: sliceType$3, tag: ""}]);
	funcType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"func\""}, {prop: "inCount", name: "inCount", exported: false, typ: $Uint16, tag: ""}, {prop: "outCount", name: "outCount", exported: false, typ: $Uint16, tag: ""}, {prop: "_in", name: "_in", exported: false, typ: sliceType$2, tag: ""}, {prop: "_out", name: "_out", exported: false, typ: sliceType$2, tag: ""}]);
	name.init("reflect", [{prop: "bytes", name: "bytes", exported: false, typ: ptrType$5, tag: ""}]);
	nameData.init("reflect", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "tag", name: "tag", exported: false, typ: $String, tag: ""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: $String, tag: ""}, {prop: "exported", name: "exported", exported: false, typ: $Bool, tag: ""}]);
	mapIter.init("reflect", [{prop: "t", name: "t", exported: false, typ: Type, tag: ""}, {prop: "m", name: "m", exported: false, typ: ptrType$3, tag: ""}, {prop: "keys", name: "keys", exported: false, typ: ptrType$3, tag: ""}, {prop: "i", name: "i", exported: false, typ: $Int, tag: ""}]);
	Type.init([{prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$6], false)}]);
	rtype.init("reflect", [{prop: "size", name: "size", exported: false, typ: $Uintptr, tag: ""}, {prop: "ptrdata", name: "ptrdata", exported: false, typ: $Uintptr, tag: ""}, {prop: "hash", name: "hash", exported: false, typ: $Uint32, tag: ""}, {prop: "tflag", name: "tflag", exported: false, typ: tflag, tag: ""}, {prop: "align", name: "align", exported: false, typ: $Uint8, tag: ""}, {prop: "fieldAlign", name: "fieldAlign", exported: false, typ: $Uint8, tag: ""}, {prop: "kind", name: "kind", exported: false, typ: $Uint8, tag: ""}, {prop: "alg", name: "alg", exported: false, typ: ptrType$4, tag: ""}, {prop: "gcdata", name: "gcdata", exported: false, typ: ptrType$5, tag: ""}, {prop: "str", name: "str", exported: false, typ: nameOff, tag: ""}, {prop: "ptrToThis", name: "ptrToThis", exported: false, typ: typeOff, tag: ""}]);
	typeAlg.init("reflect", [{prop: "hash", name: "hash", exported: false, typ: funcType$4, tag: ""}, {prop: "equal", name: "equal", exported: false, typ: funcType$5, tag: ""}]);
	method.init("reflect", [{prop: "name", name: "name", exported: false, typ: nameOff, tag: ""}, {prop: "mtyp", name: "mtyp", exported: false, typ: typeOff, tag: ""}, {prop: "ifn", name: "ifn", exported: false, typ: textOff, tag: ""}, {prop: "tfn", name: "tfn", exported: false, typ: textOff, tag: ""}]);
	arrayType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"array\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "slice", name: "slice", exported: false, typ: ptrType$1, tag: ""}, {prop: "len", name: "len", exported: false, typ: $Uintptr, tag: ""}]);
	chanType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"chan\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "dir", name: "dir", exported: false, typ: $Uintptr, tag: ""}]);
	imethod.init("reflect", [{prop: "name", name: "name", exported: false, typ: nameOff, tag: ""}, {prop: "typ", name: "typ", exported: false, typ: typeOff, tag: ""}]);
	interfaceType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"interface\""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: name, tag: ""}, {prop: "methods", name: "methods", exported: false, typ: sliceType$7, tag: ""}]);
	mapType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"map\""}, {prop: "key", name: "key", exported: false, typ: ptrType$1, tag: ""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "bucket", name: "bucket", exported: false, typ: ptrType$1, tag: ""}, {prop: "hmap", name: "hmap", exported: false, typ: ptrType$1, tag: ""}, {prop: "keysize", name: "keysize", exported: false, typ: $Uint8, tag: ""}, {prop: "indirectkey", name: "indirectkey", exported: false, typ: $Uint8, tag: ""}, {prop: "valuesize", name: "valuesize", exported: false, typ: $Uint8, tag: ""}, {prop: "indirectvalue", name: "indirectvalue", exported: false, typ: $Uint8, tag: ""}, {prop: "bucketsize", name: "bucketsize", exported: false, typ: $Uint16, tag: ""}, {prop: "reflexivekey", name: "reflexivekey", exported: false, typ: $Bool, tag: ""}, {prop: "needkeyupdate", name: "needkeyupdate", exported: false, typ: $Bool, tag: ""}]);
	ptrType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"ptr\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}]);
	sliceType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"slice\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}]);
	structField.init("reflect", [{prop: "name", name: "name", exported: false, typ: name, tag: ""}, {prop: "typ", name: "typ", exported: false, typ: ptrType$1, tag: ""}, {prop: "offset", name: "offset", exported: false, typ: $Uintptr, tag: ""}]);
	structType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"struct\""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: name, tag: ""}, {prop: "fields", name: "fields", exported: false, typ: sliceType$8, tag: ""}]);
	Method.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: Type, tag: ""}, {prop: "Func", name: "Func", exported: true, typ: Value, tag: ""}, {prop: "Index", name: "Index", exported: true, typ: $Int, tag: ""}]);
	StructField.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: Type, tag: ""}, {prop: "Tag", name: "Tag", exported: true, typ: StructTag, tag: ""}, {prop: "Offset", name: "Offset", exported: true, typ: $Uintptr, tag: ""}, {prop: "Index", name: "Index", exported: true, typ: sliceType$14, tag: ""}, {prop: "Anonymous", name: "Anonymous", exported: true, typ: $Bool, tag: ""}]);
	fieldScan.init("reflect", [{prop: "typ", name: "typ", exported: false, typ: ptrType$10, tag: ""}, {prop: "index", name: "index", exported: false, typ: sliceType$14, tag: ""}]);
	Value.init("reflect", [{prop: "typ", name: "typ", exported: false, typ: ptrType$1, tag: ""}, {prop: "ptr", name: "ptr", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "flag", name: "", exported: false, typ: flag, tag: ""}]);
	ValueError.init("", [{prop: "Method", name: "Method", exported: true, typ: $String, tag: ""}, {prop: "Kind", name: "Kind", exported: true, typ: Kind, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		nameOffList = sliceType$1.nil;
		typeOffList = sliceType$2.nil;
		methodCache = new structType$1.ptr(new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0), false);
		initialized = false;
		uncommonTypeMap = {};
		nameMap = {};
		callHelper = $assertType($internalize($call, $emptyInterface), funcType$1);
		selectHelper = $assertType($internalize($select, $emptyInterface), funcType$1);
		kindNames = new sliceType$6(["invalid", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "array", "chan", "func", "interface", "map", "ptr", "slice", "string", "struct", "unsafe.Pointer"]);
		jsObjectPtr = reflectType($jsObjectPtr);
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$r = init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["fmt"] = (function() {
	var $pkg = {}, $init, errors, io, math, os, reflect, strconv, sync, utf8, fmtFlags, fmt, State, Formatter, Stringer, GoStringer, buffer, pp, scanError, ss, ssave, sliceType, ptrType, ptrType$1, arrayType, arrayType$1, sliceType$1, sliceType$2, ptrType$2, ptrType$5, ptrType$25, funcType, ppFree, byteType, space, ssFree, complexError, boolError, newPrinter, Fprintf, Sprintf, Errorf, Fprint, Sprint, Fprintln, getField, tooLarge, parsenum, intFromArg, parseArgNumber, isSpace, notSpace, indexRune;
	errors = $packages["errors"];
	io = $packages["io"];
	math = $packages["math"];
	os = $packages["os"];
	reflect = $packages["reflect"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	utf8 = $packages["unicode/utf8"];
	fmtFlags = $pkg.fmtFlags = $newType(0, $kindStruct, "fmt.fmtFlags", true, "fmt", false, function(widPresent_, precPresent_, minus_, plus_, sharp_, space_, zero_, plusV_, sharpV_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.widPresent = false;
			this.precPresent = false;
			this.minus = false;
			this.plus = false;
			this.sharp = false;
			this.space = false;
			this.zero = false;
			this.plusV = false;
			this.sharpV = false;
			return;
		}
		this.widPresent = widPresent_;
		this.precPresent = precPresent_;
		this.minus = minus_;
		this.plus = plus_;
		this.sharp = sharp_;
		this.space = space_;
		this.zero = zero_;
		this.plusV = plusV_;
		this.sharpV = sharpV_;
	});
	fmt = $pkg.fmt = $newType(0, $kindStruct, "fmt.fmt", true, "fmt", false, function(buf_, fmtFlags_, wid_, prec_, intbuf_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = ptrType$1.nil;
			this.fmtFlags = new fmtFlags.ptr(false, false, false, false, false, false, false, false, false);
			this.wid = 0;
			this.prec = 0;
			this.intbuf = arrayType.zero();
			return;
		}
		this.buf = buf_;
		this.fmtFlags = fmtFlags_;
		this.wid = wid_;
		this.prec = prec_;
		this.intbuf = intbuf_;
	});
	State = $pkg.State = $newType(8, $kindInterface, "fmt.State", true, "fmt", true, null);
	Formatter = $pkg.Formatter = $newType(8, $kindInterface, "fmt.Formatter", true, "fmt", true, null);
	Stringer = $pkg.Stringer = $newType(8, $kindInterface, "fmt.Stringer", true, "fmt", true, null);
	GoStringer = $pkg.GoStringer = $newType(8, $kindInterface, "fmt.GoStringer", true, "fmt", true, null);
	buffer = $pkg.buffer = $newType(12, $kindSlice, "fmt.buffer", true, "fmt", false, null);
	pp = $pkg.pp = $newType(0, $kindStruct, "fmt.pp", true, "fmt", false, function(buf_, arg_, value_, fmt_, reordered_, goodArgNum_, panicking_, erroring_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = buffer.nil;
			this.arg = $ifaceNil;
			this.value = new reflect.Value.ptr(ptrType.nil, 0, 0);
			this.fmt = new fmt.ptr(ptrType$1.nil, new fmtFlags.ptr(false, false, false, false, false, false, false, false, false), 0, 0, arrayType.zero());
			this.reordered = false;
			this.goodArgNum = false;
			this.panicking = false;
			this.erroring = false;
			return;
		}
		this.buf = buf_;
		this.arg = arg_;
		this.value = value_;
		this.fmt = fmt_;
		this.reordered = reordered_;
		this.goodArgNum = goodArgNum_;
		this.panicking = panicking_;
		this.erroring = erroring_;
	});
	scanError = $pkg.scanError = $newType(0, $kindStruct, "fmt.scanError", true, "fmt", false, function(err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.err = $ifaceNil;
			return;
		}
		this.err = err_;
	});
	ss = $pkg.ss = $newType(0, $kindStruct, "fmt.ss", true, "fmt", false, function(rs_, buf_, count_, atEOF_, ssave_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rs = $ifaceNil;
			this.buf = buffer.nil;
			this.count = 0;
			this.atEOF = false;
			this.ssave = new ssave.ptr(false, false, false, 0, 0, 0);
			return;
		}
		this.rs = rs_;
		this.buf = buf_;
		this.count = count_;
		this.atEOF = atEOF_;
		this.ssave = ssave_;
	});
	ssave = $pkg.ssave = $newType(0, $kindStruct, "fmt.ssave", true, "fmt", false, function(validSave_, nlIsEnd_, nlIsSpace_, argLimit_, limit_, maxWid_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.validSave = false;
			this.nlIsEnd = false;
			this.nlIsSpace = false;
			this.argLimit = 0;
			this.limit = 0;
			this.maxWid = 0;
			return;
		}
		this.validSave = validSave_;
		this.nlIsEnd = nlIsEnd_;
		this.nlIsSpace = nlIsSpace_;
		this.argLimit = argLimit_;
		this.limit = limit_;
		this.maxWid = maxWid_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(reflect.rtype);
	ptrType$1 = $ptrType(buffer);
	arrayType = $arrayType($Uint8, 68);
	arrayType$1 = $arrayType($Uint16, 2);
	sliceType$1 = $sliceType(arrayType$1);
	sliceType$2 = $sliceType($Uint8);
	ptrType$2 = $ptrType(pp);
	ptrType$5 = $ptrType(ss);
	ptrType$25 = $ptrType(fmt);
	funcType = $funcType([$Int32], [$Bool], false);
	fmt.ptr.prototype.clearflags = function() {
		var $ptr, f;
		f = this;
		fmtFlags.copy(f.fmtFlags, new fmtFlags.ptr(false, false, false, false, false, false, false, false, false));
	};
	fmt.prototype.clearflags = function() { return this.$val.clearflags(); };
	fmt.ptr.prototype.init = function(buf) {
		var $ptr, buf, f;
		f = this;
		f.buf = buf;
		f.clearflags();
	};
	fmt.prototype.init = function(buf) { return this.$val.init(buf); };
	fmt.ptr.prototype.writePadding = function(n) {
		var $ptr, _i, _ref, buf, f, i, n, newLen, oldLen, padByte, padding;
		f = this;
		if (n <= 0) {
			return;
		}
		buf = f.buf.$get();
		oldLen = buf.$length;
		newLen = oldLen + n >> 0;
		if (newLen > buf.$capacity) {
			buf = $makeSlice(buffer, (($imul(buf.$capacity, 2)) + n >> 0));
			$copySlice(buf, f.buf.$get());
		}
		padByte = 32;
		if (f.fmtFlags.zero) {
			padByte = 48;
		}
		padding = $subslice(buf, oldLen, newLen);
		_ref = padding;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= padding.$length) ? $throwRuntimeError("index out of range") : padding.$array[padding.$offset + i] = padByte);
			_i++;
		}
		f.buf.$set($subslice(buf, 0, newLen));
	};
	fmt.prototype.writePadding = function(n) { return this.$val.writePadding(n); };
	fmt.ptr.prototype.pad = function(b) {
		var $ptr, b, f, width;
		f = this;
		if (!f.fmtFlags.widPresent || (f.wid === 0)) {
			f.buf.Write(b);
			return;
		}
		width = f.wid - utf8.RuneCount(b) >> 0;
		if (!f.fmtFlags.minus) {
			f.writePadding(width);
			f.buf.Write(b);
		} else {
			f.buf.Write(b);
			f.writePadding(width);
		}
	};
	fmt.prototype.pad = function(b) { return this.$val.pad(b); };
	fmt.ptr.prototype.padString = function(s) {
		var $ptr, f, s, width;
		f = this;
		if (!f.fmtFlags.widPresent || (f.wid === 0)) {
			f.buf.WriteString(s);
			return;
		}
		width = f.wid - utf8.RuneCountInString(s) >> 0;
		if (!f.fmtFlags.minus) {
			f.writePadding(width);
			f.buf.WriteString(s);
		} else {
			f.buf.WriteString(s);
			f.writePadding(width);
		}
	};
	fmt.prototype.padString = function(s) { return this.$val.padString(s); };
	fmt.ptr.prototype.fmt_boolean = function(v) {
		var $ptr, f, v;
		f = this;
		if (v) {
			f.padString("true");
		} else {
			f.padString("false");
		}
	};
	fmt.prototype.fmt_boolean = function(v) { return this.$val.fmt_boolean(v); };
	fmt.ptr.prototype.fmt_unicode = function(u) {
		var $ptr, buf, f, i, oldZero, prec, u, width;
		f = this;
		buf = $subslice(new sliceType$2(f.intbuf), 0);
		prec = 4;
		if (f.fmtFlags.precPresent && f.prec > 4) {
			prec = f.prec;
			width = (((2 + prec >> 0) + 2 >> 0) + 4 >> 0) + 1 >> 0;
			if (width > buf.$length) {
				buf = $makeSlice(sliceType$2, width);
			}
		}
		i = buf.$length;
		if (f.fmtFlags.sharp && (u.$high < 0 || (u.$high === 0 && u.$low <= 1114111)) && strconv.IsPrint((u.$low >> 0))) {
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 39);
			i = i - (utf8.RuneLen((u.$low >> 0))) >> 0;
			utf8.EncodeRune($subslice(buf, i), (u.$low >> 0));
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 39);
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 32);
		}
		while (true) {
			if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 16)))) { break; }
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = "0123456789ABCDEFX".charCodeAt($flatten64(new $Uint64(u.$high & 0, (u.$low & 15) >>> 0))));
			prec = prec - (1) >> 0;
			u = $shiftRightUint64(u, (4));
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = "0123456789ABCDEFX".charCodeAt($flatten64(u)));
		prec = prec - (1) >> 0;
		while (true) {
			if (!(prec > 0)) { break; }
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 48);
			prec = prec - (1) >> 0;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 43);
		i = i - (1) >> 0;
		((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 85);
		oldZero = f.fmtFlags.zero;
		f.fmtFlags.zero = false;
		f.pad($subslice(buf, i));
		f.fmtFlags.zero = oldZero;
	};
	fmt.prototype.fmt_unicode = function(u) { return this.$val.fmt_unicode(u); };
	fmt.ptr.prototype.fmt_integer = function(u, base, isSigned, digits) {
		var $ptr, _1, _2, base, buf, digits, f, i, isSigned, negative, next, oldZero, oldZero$1, prec, u, width, x, x$1, x$2, x$3, x$4;
		f = this;
		negative = isSigned && (x = new $Int64(u.$high, u.$low), (x.$high < 0 || (x.$high === 0 && x.$low < 0)));
		if (negative) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		buf = $subslice(new sliceType$2(f.intbuf), 0);
		if (f.fmtFlags.widPresent || f.fmtFlags.precPresent) {
			width = (3 + f.wid >> 0) + f.prec >> 0;
			if (width > buf.$length) {
				buf = $makeSlice(sliceType$2, width);
			}
		}
		prec = 0;
		if (f.fmtFlags.precPresent) {
			prec = f.prec;
			if ((prec === 0) && (u.$high === 0 && u.$low === 0)) {
				oldZero = f.fmtFlags.zero;
				f.fmtFlags.zero = false;
				f.writePadding(f.wid);
				f.fmtFlags.zero = oldZero;
				return;
			}
		} else if (f.fmtFlags.zero && f.fmtFlags.widPresent) {
			prec = f.wid;
			if (negative || f.fmtFlags.plus || f.fmtFlags.space) {
				prec = prec - (1) >> 0;
			}
		}
		i = buf.$length;
		_1 = base;
		if (_1 === (10)) {
			while (true) {
				if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 10)))) { break; }
				i = i - (1) >> 0;
				next = $div64(u, new $Uint64(0, 10), false);
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = ((x$1 = new $Uint64(0 + u.$high, 48 + u.$low), x$2 = $mul64(next, new $Uint64(0, 10)), new $Uint64(x$1.$high - x$2.$high, x$1.$low - x$2.$low)).$low << 24 >>> 24));
				u = next;
			}
		} else if (_1 === (16)) {
			while (true) {
				if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 16)))) { break; }
				i = i - (1) >> 0;
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = digits.charCodeAt($flatten64(new $Uint64(u.$high & 0, (u.$low & 15) >>> 0))));
				u = $shiftRightUint64(u, (4));
			}
		} else if (_1 === (8)) {
			while (true) {
				if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 8)))) { break; }
				i = i - (1) >> 0;
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = ((x$3 = new $Uint64(u.$high & 0, (u.$low & 7) >>> 0), new $Uint64(0 + x$3.$high, 48 + x$3.$low)).$low << 24 >>> 24));
				u = $shiftRightUint64(u, (3));
			}
		} else if (_1 === (2)) {
			while (true) {
				if (!((u.$high > 0 || (u.$high === 0 && u.$low >= 2)))) { break; }
				i = i - (1) >> 0;
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = ((x$4 = new $Uint64(u.$high & 0, (u.$low & 1) >>> 0), new $Uint64(0 + x$4.$high, 48 + x$4.$low)).$low << 24 >>> 24));
				u = $shiftRightUint64(u, (1));
			}
		} else {
			$panic(new $String("fmt: unknown base; can't happen"));
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = digits.charCodeAt($flatten64(u)));
		while (true) {
			if (!(i > 0 && prec > (buf.$length - i >> 0))) { break; }
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 48);
		}
		if (f.fmtFlags.sharp) {
			_2 = base;
			if (_2 === (8)) {
				if (!((((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i]) === 48))) {
					i = i - (1) >> 0;
					((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 48);
				}
			} else if (_2 === (16)) {
				i = i - (1) >> 0;
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = digits.charCodeAt(16));
				i = i - (1) >> 0;
				((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 48);
			}
		}
		if (negative) {
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 45);
		} else if (f.fmtFlags.plus) {
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 43);
		} else if (f.fmtFlags.space) {
			i = i - (1) >> 0;
			((i < 0 || i >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + i] = 32);
		}
		oldZero$1 = f.fmtFlags.zero;
		f.fmtFlags.zero = false;
		f.pad($subslice(buf, i));
		f.fmtFlags.zero = oldZero$1;
	};
	fmt.prototype.fmt_integer = function(u, base, isSigned, digits) { return this.$val.fmt_integer(u, base, isSigned, digits); };
	fmt.ptr.prototype.truncate = function(s) {
		var $ptr, _i, _ref, _rune, f, i, n, s;
		f = this;
		if (f.fmtFlags.precPresent) {
			n = f.prec;
			_ref = s;
			_i = 0;
			while (true) {
				if (!(_i < _ref.length)) { break; }
				_rune = $decodeRune(_ref, _i);
				i = _i;
				n = n - (1) >> 0;
				if (n < 0) {
					return $substring(s, 0, i);
				}
				_i += _rune[1];
			}
		}
		return s;
	};
	fmt.prototype.truncate = function(s) { return this.$val.truncate(s); };
	fmt.ptr.prototype.fmt_s = function(s) {
		var $ptr, f, s;
		f = this;
		s = f.truncate(s);
		f.padString(s);
	};
	fmt.prototype.fmt_s = function(s) { return this.$val.fmt_s(s); };
	fmt.ptr.prototype.fmt_sbx = function(s, b, digits) {
		var $ptr, b, buf, c, digits, f, i, length, s, width;
		f = this;
		length = b.$length;
		if (b === sliceType$2.nil) {
			length = s.length;
		}
		if (f.fmtFlags.precPresent && f.prec < length) {
			length = f.prec;
		}
		width = $imul(2, length);
		if (width > 0) {
			if (f.fmtFlags.space) {
				if (f.fmtFlags.sharp) {
					width = $imul(width, (2));
				}
				width = width + ((length - 1 >> 0)) >> 0;
			} else if (f.fmtFlags.sharp) {
				width = width + (2) >> 0;
			}
		} else {
			if (f.fmtFlags.widPresent) {
				f.writePadding(f.wid);
			}
			return;
		}
		if (f.fmtFlags.widPresent && f.wid > width && !f.fmtFlags.minus) {
			f.writePadding(f.wid - width >> 0);
		}
		buf = f.buf.$get();
		if (f.fmtFlags.sharp) {
			buf = $append(buf, 48, digits.charCodeAt(16));
		}
		c = 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			if (f.fmtFlags.space && i > 0) {
				buf = $append(buf, 32);
				if (f.fmtFlags.sharp) {
					buf = $append(buf, 48, digits.charCodeAt(16));
				}
			}
			if (!(b === sliceType$2.nil)) {
				c = ((i < 0 || i >= b.$length) ? $throwRuntimeError("index out of range") : b.$array[b.$offset + i]);
			} else {
				c = s.charCodeAt(i);
			}
			buf = $append(buf, digits.charCodeAt((c >>> 4 << 24 >>> 24)), digits.charCodeAt(((c & 15) >>> 0)));
			i = i + (1) >> 0;
		}
		f.buf.$set(buf);
		if (f.fmtFlags.widPresent && f.wid > width && f.fmtFlags.minus) {
			f.writePadding(f.wid - width >> 0);
		}
	};
	fmt.prototype.fmt_sbx = function(s, b, digits) { return this.$val.fmt_sbx(s, b, digits); };
	fmt.ptr.prototype.fmt_sx = function(s, digits) {
		var $ptr, digits, f, s;
		f = this;
		f.fmt_sbx(s, sliceType$2.nil, digits);
	};
	fmt.prototype.fmt_sx = function(s, digits) { return this.$val.fmt_sx(s, digits); };
	fmt.ptr.prototype.fmt_bx = function(b, digits) {
		var $ptr, b, digits, f;
		f = this;
		f.fmt_sbx("", b, digits);
	};
	fmt.prototype.fmt_bx = function(b, digits) { return this.$val.fmt_bx(b, digits); };
	fmt.ptr.prototype.fmt_q = function(s) {
		var $ptr, buf, f, s;
		f = this;
		s = f.truncate(s);
		if (f.fmtFlags.sharp && strconv.CanBackquote(s)) {
			f.padString("`" + s + "`");
			return;
		}
		buf = $subslice(new sliceType$2(f.intbuf), 0, 0);
		if (f.fmtFlags.plus) {
			f.pad(strconv.AppendQuoteToASCII(buf, s));
		} else {
			f.pad(strconv.AppendQuote(buf, s));
		}
	};
	fmt.prototype.fmt_q = function(s) { return this.$val.fmt_q(s); };
	fmt.ptr.prototype.fmt_c = function(c) {
		var $ptr, buf, c, f, r, w;
		f = this;
		r = (c.$low >> 0);
		if ((c.$high > 0 || (c.$high === 0 && c.$low > 1114111))) {
			r = 65533;
		}
		buf = $subslice(new sliceType$2(f.intbuf), 0, 0);
		w = utf8.EncodeRune($subslice(buf, 0, 4), r);
		f.pad($subslice(buf, 0, w));
	};
	fmt.prototype.fmt_c = function(c) { return this.$val.fmt_c(c); };
	fmt.ptr.prototype.fmt_qc = function(c) {
		var $ptr, buf, c, f, r;
		f = this;
		r = (c.$low >> 0);
		if ((c.$high > 0 || (c.$high === 0 && c.$low > 1114111))) {
			r = 65533;
		}
		buf = $subslice(new sliceType$2(f.intbuf), 0, 0);
		if (f.fmtFlags.plus) {
			f.pad(strconv.AppendQuoteRuneToASCII(buf, r));
		} else {
			f.pad(strconv.AppendQuoteRune(buf, r));
		}
	};
	fmt.prototype.fmt_qc = function(c) { return this.$val.fmt_qc(c); };
	fmt.ptr.prototype.fmt_float = function(v, size, verb, prec) {
		var $ptr, f, num, oldZero, prec, size, v, verb;
		f = this;
		if (f.fmtFlags.precPresent) {
			prec = f.prec;
		}
		num = strconv.AppendFloat($subslice(new sliceType$2(f.intbuf), 0, 1), v, (verb << 24 >>> 24), prec, size);
		if (((1 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 1]) === 45) || ((1 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 1]) === 43)) {
			num = $subslice(num, 1);
		} else {
			(0 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 0] = 43);
		}
		if (f.fmtFlags.space && ((0 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 0]) === 43) && !f.fmtFlags.plus) {
			(0 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 0] = 32);
		}
		if (((1 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 1]) === 73) || ((1 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 1]) === 78)) {
			oldZero = f.fmtFlags.zero;
			f.fmtFlags.zero = false;
			if (((1 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 1]) === 78) && !f.fmtFlags.space && !f.fmtFlags.plus) {
				num = $subslice(num, 1);
			}
			f.pad(num);
			f.fmtFlags.zero = oldZero;
			return;
		}
		if (f.fmtFlags.plus || !(((0 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 0]) === 43))) {
			if (f.fmtFlags.zero && f.fmtFlags.widPresent && f.wid > num.$length) {
				f.buf.WriteByte((0 >= num.$length ? $throwRuntimeError("index out of range") : num.$array[num.$offset + 0]));
				f.writePadding(f.wid - num.$length >> 0);
				f.buf.Write($subslice(num, 1));
				return;
			}
			f.pad(num);
			return;
		}
		f.pad($subslice(num, 1));
	};
	fmt.prototype.fmt_float = function(v, size, verb, prec) { return this.$val.fmt_float(v, size, verb, prec); };
	$ptrType(buffer).prototype.Write = function(p) {
		var $ptr, b, p;
		b = this;
		b.$set($appendSlice(b.$get(), p));
	};
	$ptrType(buffer).prototype.WriteString = function(s) {
		var $ptr, b, s;
		b = this;
		b.$set($appendSlice(b.$get(), s));
	};
	$ptrType(buffer).prototype.WriteByte = function(c) {
		var $ptr, b, c;
		b = this;
		b.$set($append(b.$get(), c));
	};
	$ptrType(buffer).prototype.WriteRune = function(r) {
		var $ptr, b, bp, n, r, w, x;
		bp = this;
		if (r < 128) {
			bp.$set($append(bp.$get(), (r << 24 >>> 24)));
			return;
		}
		b = bp.$get();
		n = b.$length;
		while (true) {
			if (!((n + 4 >> 0) > b.$capacity)) { break; }
			b = $append(b, 0);
		}
		w = utf8.EncodeRune((x = $subslice(b, n, (n + 4 >> 0)), $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length)), r);
		bp.$set($subslice(b, 0, (n + w >> 0)));
	};
	newPrinter = function() {
		var $ptr, _r, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = ppFree.Get(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = $assertType(_r, ptrType$2);
		p.panicking = false;
		p.erroring = false;
		p.fmt.init((p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))));
		$s = -1; return p;
		return p;
		/* */ } return; } if ($f === undefined) { $f = { $blk: newPrinter }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.ptr.prototype.free = function() {
		var $ptr, p;
		p = this;
		p.buf = $subslice(p.buf, 0, 0);
		p.arg = $ifaceNil;
		p.value = new reflect.Value.ptr(ptrType.nil, 0, 0);
		ppFree.Put(p);
	};
	pp.prototype.free = function() { return this.$val.free(); };
	pp.ptr.prototype.Width = function() {
		var $ptr, _tmp, _tmp$1, ok, p, wid;
		wid = 0;
		ok = false;
		p = this;
		_tmp = p.fmt.wid;
		_tmp$1 = p.fmt.fmtFlags.widPresent;
		wid = _tmp;
		ok = _tmp$1;
		return [wid, ok];
	};
	pp.prototype.Width = function() { return this.$val.Width(); };
	pp.ptr.prototype.Precision = function() {
		var $ptr, _tmp, _tmp$1, ok, p, prec;
		prec = 0;
		ok = false;
		p = this;
		_tmp = p.fmt.prec;
		_tmp$1 = p.fmt.fmtFlags.precPresent;
		prec = _tmp;
		ok = _tmp$1;
		return [prec, ok];
	};
	pp.prototype.Precision = function() { return this.$val.Precision(); };
	pp.ptr.prototype.Flag = function(b) {
		var $ptr, _1, b, p;
		p = this;
		_1 = b;
		if (_1 === (45)) {
			return p.fmt.fmtFlags.minus;
		} else if (_1 === (43)) {
			return p.fmt.fmtFlags.plus || p.fmt.fmtFlags.plusV;
		} else if (_1 === (35)) {
			return p.fmt.fmtFlags.sharp || p.fmt.fmtFlags.sharpV;
		} else if (_1 === (32)) {
			return p.fmt.fmtFlags.space;
		} else if (_1 === (48)) {
			return p.fmt.fmtFlags.zero;
		}
		return false;
	};
	pp.prototype.Flag = function(b) { return this.$val.Flag(b); };
	pp.ptr.prototype.Write = function(b) {
		var $ptr, _tmp, _tmp$1, b, err, p, ret;
		ret = 0;
		err = $ifaceNil;
		p = this;
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).Write(b);
		_tmp = b.$length;
		_tmp$1 = $ifaceNil;
		ret = _tmp;
		err = _tmp$1;
		return [ret, err];
	};
	pp.prototype.Write = function(b) { return this.$val.Write(b); };
	Fprintf = function(w, format, a) {
		var $ptr, _r, _r$1, _tuple, a, err, format, n, p, w, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; err = $f.err; format = $f.format; n = $f.n; p = $f.p; w = $f.w; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		_r = newPrinter(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		$r = p.doPrintf(format, a); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r$1 = w.Write((x = p.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length))); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		n = _tuple[0];
		err = _tuple[1];
		p.free();
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Fprintf }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.err = err; $f.format = format; $f.n = n; $f.p = p; $f.w = w; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Fprintf = Fprintf;
	Sprintf = function(format, a) {
		var $ptr, _r, a, format, p, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; format = $f.format; p = $f.p; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = newPrinter(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		$r = p.doPrintf(format, a); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		s = $bytesToString(p.buf);
		p.free();
		$s = -1; return s;
		return s;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Sprintf }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.format = format; $f.p = p; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sprintf = Sprintf;
	Errorf = function(format, a) {
		var $ptr, _r, _r$1, a, format, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; a = $f.a; format = $f.format; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Sprintf(format, a); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = errors.New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Errorf }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.format = format; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Errorf = Errorf;
	Fprint = function(w, a) {
		var $ptr, _r, _r$1, _tuple, a, err, n, p, w, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; err = $f.err; n = $f.n; p = $f.p; w = $f.w; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		_r = newPrinter(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		$r = p.doPrint(a); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r$1 = w.Write((x = p.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length))); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		n = _tuple[0];
		err = _tuple[1];
		p.free();
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Fprint }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.err = err; $f.n = n; $f.p = p; $f.w = w; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Fprint = Fprint;
	Sprint = function(a) {
		var $ptr, _r, a, p, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; p = $f.p; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = newPrinter(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		$r = p.doPrint(a); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		s = $bytesToString(p.buf);
		p.free();
		$s = -1; return s;
		return s;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Sprint }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.p = p; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sprint = Sprint;
	Fprintln = function(w, a) {
		var $ptr, _r, _r$1, _tuple, a, err, n, p, w, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; err = $f.err; n = $f.n; p = $f.p; w = $f.w; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		_r = newPrinter(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		p = _r;
		$r = p.doPrintln(a); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r$1 = w.Write((x = p.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length))); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		n = _tuple[0];
		err = _tuple[1];
		p.free();
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Fprintln }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.err = err; $f.n = n; $f.p = p; $f.w = w; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Fprintln = Fprintln;
	getField = function(v, i) {
		var $ptr, _r, _r$1, i, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; i = $f.i; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = v.Field(i); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		val = _r;
		/* */ if ((val.Kind() === 20) && !val.IsNil()) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if ((val.Kind() === 20) && !val.IsNil()) { */ case 2:
			_r$1 = val.Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			val = _r$1;
		/* } */ case 3:
		$s = -1; return val;
		return val;
		/* */ } return; } if ($f === undefined) { $f = { $blk: getField }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.i = i; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	tooLarge = function(x) {
		var $ptr, x;
		return x > 1000000 || x < -1000000;
	};
	parsenum = function(s, start, end) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, end, isnum, newi, num, s, start;
		num = 0;
		isnum = false;
		newi = 0;
		if (start >= end) {
			_tmp = 0;
			_tmp$1 = false;
			_tmp$2 = end;
			num = _tmp;
			isnum = _tmp$1;
			newi = _tmp$2;
			return [num, isnum, newi];
		}
		newi = start;
		while (true) {
			if (!(newi < end && 48 <= s.charCodeAt(newi) && s.charCodeAt(newi) <= 57)) { break; }
			if (tooLarge(num)) {
				_tmp$3 = 0;
				_tmp$4 = false;
				_tmp$5 = end;
				num = _tmp$3;
				isnum = _tmp$4;
				newi = _tmp$5;
				return [num, isnum, newi];
			}
			num = ($imul(num, 10)) + ((s.charCodeAt(newi) - 48 << 24 >>> 24) >> 0) >> 0;
			isnum = true;
			newi = newi + (1) >> 0;
		}
		return [num, isnum, newi];
	};
	pp.ptr.prototype.unknownType = function(v) {
		var $ptr, _r, p, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		p = this;
		if (!v.IsValid()) {
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
			$s = -1; return;
			return;
		}
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(63);
		_r = v.Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(63);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.unknownType }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.unknownType = function(v) { return this.$val.unknownType(v); };
	pp.ptr.prototype.badVerb = function(verb) {
		var $ptr, _r, _r$1, p, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; p = $f.p; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		p.erroring = true;
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!");
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteRune(verb);
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(40);
			/* */ if (!($interfaceIsEqual(p.arg, $ifaceNil))) { $s = 2; continue; }
			/* */ if (p.value.IsValid()) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!($interfaceIsEqual(p.arg, $ifaceNil))) { */ case 2:
				_r = reflect.TypeOf(p.arg).String(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(61);
				$r = p.printArg(p.arg, 118); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 5; continue;
			/* } else if (p.value.IsValid()) { */ case 3:
				_r$1 = p.value.Type().String(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$1); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(61);
				$r = p.printValue(p.value, 118, 0); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 5; continue;
			/* } else { */ case 4:
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
			/* } */ case 5:
		case 1:
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(41);
		p.erroring = false;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.badVerb }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.p = p; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.badVerb = function(verb) { return this.$val.badVerb(verb); };
	pp.ptr.prototype.fmtBool = function(v, verb) {
		var $ptr, _1, p, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; p = $f.p; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if ((_1 === (116)) || (_1 === (118))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if ((_1 === (116)) || (_1 === (118))) { */ case 2:
				p.fmt.fmt_boolean(v);
				$s = 4; continue;
			/* } else { */ case 3:
				$r = p.badVerb(verb); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtBool }; } $f.$ptr = $ptr; $f._1 = _1; $f.p = p; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtBool = function(v, verb) { return this.$val.fmtBool(v, verb); };
	pp.ptr.prototype.fmt0x64 = function(v, leading0x) {
		var $ptr, leading0x, p, sharp, v;
		p = this;
		sharp = p.fmt.fmtFlags.sharp;
		p.fmt.fmtFlags.sharp = leading0x;
		p.fmt.fmt_integer(v, 16, false, "0123456789abcdefx");
		p.fmt.fmtFlags.sharp = sharp;
	};
	pp.prototype.fmt0x64 = function(v, leading0x) { return this.$val.fmt0x64(v, leading0x); };
	pp.ptr.prototype.fmtInteger = function(v, isSigned, verb) {
		var $ptr, _1, isSigned, p, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; isSigned = $f.isSigned; p = $f.p; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if (_1 === (118)) { $s = 2; continue; }
			/* */ if (_1 === (100)) { $s = 3; continue; }
			/* */ if (_1 === (98)) { $s = 4; continue; }
			/* */ if (_1 === (111)) { $s = 5; continue; }
			/* */ if (_1 === (120)) { $s = 6; continue; }
			/* */ if (_1 === (88)) { $s = 7; continue; }
			/* */ if (_1 === (99)) { $s = 8; continue; }
			/* */ if (_1 === (113)) { $s = 9; continue; }
			/* */ if (_1 === (85)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (_1 === (118)) { */ case 2:
				if (p.fmt.fmtFlags.sharpV && !isSigned) {
					p.fmt0x64(v, true);
				} else {
					p.fmt.fmt_integer(v, 10, isSigned, "0123456789abcdefx");
				}
				$s = 12; continue;
			/* } else if (_1 === (100)) { */ case 3:
				p.fmt.fmt_integer(v, 10, isSigned, "0123456789abcdefx");
				$s = 12; continue;
			/* } else if (_1 === (98)) { */ case 4:
				p.fmt.fmt_integer(v, 2, isSigned, "0123456789abcdefx");
				$s = 12; continue;
			/* } else if (_1 === (111)) { */ case 5:
				p.fmt.fmt_integer(v, 8, isSigned, "0123456789abcdefx");
				$s = 12; continue;
			/* } else if (_1 === (120)) { */ case 6:
				p.fmt.fmt_integer(v, 16, isSigned, "0123456789abcdefx");
				$s = 12; continue;
			/* } else if (_1 === (88)) { */ case 7:
				p.fmt.fmt_integer(v, 16, isSigned, "0123456789ABCDEFX");
				$s = 12; continue;
			/* } else if (_1 === (99)) { */ case 8:
				p.fmt.fmt_c(v);
				$s = 12; continue;
			/* } else if (_1 === (113)) { */ case 9:
				/* */ if ((v.$high < 0 || (v.$high === 0 && v.$low <= 1114111))) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if ((v.$high < 0 || (v.$high === 0 && v.$low <= 1114111))) { */ case 13:
					p.fmt.fmt_qc(v);
					$s = 15; continue;
				/* } else { */ case 14:
					$r = p.badVerb(verb); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 15:
				$s = 12; continue;
			/* } else if (_1 === (85)) { */ case 10:
				p.fmt.fmt_unicode(v);
				$s = 12; continue;
			/* } else { */ case 11:
				$r = p.badVerb(verb); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 12:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtInteger }; } $f.$ptr = $ptr; $f._1 = _1; $f.isSigned = isSigned; $f.p = p; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtInteger = function(v, isSigned, verb) { return this.$val.fmtInteger(v, isSigned, verb); };
	pp.ptr.prototype.fmtFloat = function(v, size, verb) {
		var $ptr, _1, p, size, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; p = $f.p; size = $f.size; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if (_1 === (118)) { $s = 2; continue; }
			/* */ if ((_1 === (98)) || (_1 === (103)) || (_1 === (71))) { $s = 3; continue; }
			/* */ if ((_1 === (102)) || (_1 === (101)) || (_1 === (69))) { $s = 4; continue; }
			/* */ if (_1 === (70)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (_1 === (118)) { */ case 2:
				p.fmt.fmt_float(v, size, 103, -1);
				$s = 7; continue;
			/* } else if ((_1 === (98)) || (_1 === (103)) || (_1 === (71))) { */ case 3:
				p.fmt.fmt_float(v, size, verb, -1);
				$s = 7; continue;
			/* } else if ((_1 === (102)) || (_1 === (101)) || (_1 === (69))) { */ case 4:
				p.fmt.fmt_float(v, size, verb, 6);
				$s = 7; continue;
			/* } else if (_1 === (70)) { */ case 5:
				p.fmt.fmt_float(v, size, 102, 6);
				$s = 7; continue;
			/* } else { */ case 6:
				$r = p.badVerb(verb); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 7:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtFloat }; } $f.$ptr = $ptr; $f._1 = _1; $f.p = p; $f.size = size; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtFloat = function(v, size, verb) { return this.$val.fmtFloat(v, size, verb); };
	pp.ptr.prototype.fmtComplex = function(v, size, verb) {
		var $ptr, _1, _q, _q$1, oldPlus, p, size, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _q = $f._q; _q$1 = $f._q$1; oldPlus = $f.oldPlus; p = $f.p; size = $f.size; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if ((_1 === (118)) || (_1 === (98)) || (_1 === (103)) || (_1 === (71)) || (_1 === (102)) || (_1 === (70)) || (_1 === (101)) || (_1 === (69))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if ((_1 === (118)) || (_1 === (98)) || (_1 === (103)) || (_1 === (71)) || (_1 === (102)) || (_1 === (70)) || (_1 === (101)) || (_1 === (69))) { */ case 2:
				oldPlus = p.fmt.fmtFlags.plus;
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(40);
				$r = p.fmtFloat(v.$real, (_q = size / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")), verb); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				p.fmt.fmtFlags.plus = true;
				$r = p.fmtFloat(v.$imag, (_q$1 = size / 2, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), verb); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("i)");
				p.fmt.fmtFlags.plus = oldPlus;
				$s = 4; continue;
			/* } else { */ case 3:
				$r = p.badVerb(verb); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtComplex }; } $f.$ptr = $ptr; $f._1 = _1; $f._q = _q; $f._q$1 = _q$1; $f.oldPlus = oldPlus; $f.p = p; $f.size = size; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtComplex = function(v, size, verb) { return this.$val.fmtComplex(v, size, verb); };
	pp.ptr.prototype.fmtString = function(v, verb) {
		var $ptr, _1, p, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; p = $f.p; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if (_1 === (118)) { $s = 2; continue; }
			/* */ if (_1 === (115)) { $s = 3; continue; }
			/* */ if (_1 === (120)) { $s = 4; continue; }
			/* */ if (_1 === (88)) { $s = 5; continue; }
			/* */ if (_1 === (113)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (_1 === (118)) { */ case 2:
				if (p.fmt.fmtFlags.sharpV) {
					p.fmt.fmt_q(v);
				} else {
					p.fmt.fmt_s(v);
				}
				$s = 8; continue;
			/* } else if (_1 === (115)) { */ case 3:
				p.fmt.fmt_s(v);
				$s = 8; continue;
			/* } else if (_1 === (120)) { */ case 4:
				p.fmt.fmt_sx(v, "0123456789abcdefx");
				$s = 8; continue;
			/* } else if (_1 === (88)) { */ case 5:
				p.fmt.fmt_sx(v, "0123456789ABCDEFX");
				$s = 8; continue;
			/* } else if (_1 === (113)) { */ case 6:
				p.fmt.fmt_q(v);
				$s = 8; continue;
			/* } else { */ case 7:
				$r = p.badVerb(verb); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 8:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtString }; } $f.$ptr = $ptr; $f._1 = _1; $f.p = p; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtString = function(v, verb) { return this.$val.fmtString(v, verb); };
	pp.ptr.prototype.fmtBytes = function(v, verb, typeString) {
		var $ptr, _1, _i, _i$1, _r, _ref, _ref$1, c, c$1, i, i$1, p, typeString, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; c = $f.c; c$1 = $f.c$1; i = $f.i; i$1 = $f.i$1; p = $f.p; typeString = $f.typeString; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
			_1 = verb;
			/* */ if ((_1 === (118)) || (_1 === (100))) { $s = 2; continue; }
			/* */ if (_1 === (115)) { $s = 3; continue; }
			/* */ if (_1 === (120)) { $s = 4; continue; }
			/* */ if (_1 === (88)) { $s = 5; continue; }
			/* */ if (_1 === (113)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if ((_1 === (118)) || (_1 === (100))) { */ case 2:
				if (p.fmt.fmtFlags.sharpV) {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(typeString);
					if (v === sliceType$2.nil) {
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(nil)");
						$s = -1; return;
						return;
					}
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(123);
					_ref = v;
					_i = 0;
					while (true) {
						if (!(_i < _ref.$length)) { break; }
						i = _i;
						c = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
						if (i > 0) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(", ");
						}
						p.fmt0x64(new $Uint64(0, c), true);
						_i++;
					}
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(125);
				} else {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(91);
					_ref$1 = v;
					_i$1 = 0;
					while (true) {
						if (!(_i$1 < _ref$1.$length)) { break; }
						i$1 = _i$1;
						c$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
						if (i$1 > 0) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
						}
						p.fmt.fmt_integer(new $Uint64(0, c$1), 10, false, "0123456789abcdefx");
						_i$1++;
					}
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(93);
				}
				$s = 8; continue;
			/* } else if (_1 === (115)) { */ case 3:
				p.fmt.fmt_s($bytesToString(v));
				$s = 8; continue;
			/* } else if (_1 === (120)) { */ case 4:
				p.fmt.fmt_bx(v, "0123456789abcdefx");
				$s = 8; continue;
			/* } else if (_1 === (88)) { */ case 5:
				p.fmt.fmt_bx(v, "0123456789ABCDEFX");
				$s = 8; continue;
			/* } else if (_1 === (113)) { */ case 6:
				p.fmt.fmt_q($bytesToString(v));
				$s = 8; continue;
			/* } else { */ case 7:
				_r = reflect.ValueOf(v); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$r = p.printValue(_r, verb, 0); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 8:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtBytes }; } $f.$ptr = $ptr; $f._1 = _1; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f.c = c; $f.c$1 = c$1; $f.i = i; $f.i$1 = i$1; $f.p = p; $f.typeString = typeString; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtBytes = function(v, verb, typeString) { return this.$val.fmtBytes(v, verb, typeString); };
	pp.ptr.prototype.fmtPointer = function(value, verb) {
		var $ptr, _1, _2, _r, p, u, value, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _r = $f._r; p = $f.p; u = $f.u; value = $f.value; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		value = value;
		p = this;
		u = 0;
			_1 = value.Kind();
			/* */ if ((_1 === (18)) || (_1 === (19)) || (_1 === (21)) || (_1 === (22)) || (_1 === (23)) || (_1 === (26))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if ((_1 === (18)) || (_1 === (19)) || (_1 === (21)) || (_1 === (22)) || (_1 === (23)) || (_1 === (26))) { */ case 2:
				u = value.Pointer();
				$s = 4; continue;
			/* } else { */ case 3:
				$r = p.badVerb(verb); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } */ case 4:
		case 1:
			_2 = verb;
			/* */ if (_2 === (118)) { $s = 7; continue; }
			/* */ if (_2 === (112)) { $s = 8; continue; }
			/* */ if ((_2 === (98)) || (_2 === (111)) || (_2 === (100)) || (_2 === (120)) || (_2 === (88))) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_2 === (118)) { */ case 7:
				/* */ if (p.fmt.fmtFlags.sharpV) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (p.fmt.fmtFlags.sharpV) { */ case 12:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(40);
					_r = value.Type().String(); /* */ $s = 15; case 15: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(")(");
					if (u === 0) {
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("nil");
					} else {
						p.fmt0x64(new $Uint64(0, u.constructor === Number ? u : 1), true);
					}
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(41);
					$s = 14; continue;
				/* } else { */ case 13:
					if (u === 0) {
						p.fmt.padString("<nil>");
					} else {
						p.fmt0x64(new $Uint64(0, u.constructor === Number ? u : 1), !p.fmt.fmtFlags.sharp);
					}
				/* } */ case 14:
				$s = 11; continue;
			/* } else if (_2 === (112)) { */ case 8:
				p.fmt0x64(new $Uint64(0, u.constructor === Number ? u : 1), !p.fmt.fmtFlags.sharp);
				$s = 11; continue;
			/* } else if ((_2 === (98)) || (_2 === (111)) || (_2 === (100)) || (_2 === (120)) || (_2 === (88))) { */ case 9:
				$r = p.fmtInteger(new $Uint64(0, u.constructor === Number ? u : 1), false, verb); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 11; continue;
			/* } else { */ case 10:
				$r = p.badVerb(verb); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 11:
		case 6:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.fmtPointer }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._r = _r; $f.p = p; $f.u = u; $f.value = value; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.fmtPointer = function(value, verb) { return this.$val.fmtPointer(value, verb); };
	pp.ptr.prototype.catchPanic = function(arg, verb) {
		var $ptr, _r, arg, err, p, v, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; arg = $f.arg; err = $f.err; p = $f.p; v = $f.v; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		err = $recover();
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
			_r = reflect.ValueOf(arg); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
			if ((v.Kind() === 22) && v.IsNil()) {
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
				$s = -1; return;
				return;
			}
			if (p.panicking) {
				$panic(err);
			}
			p.fmt.clearflags();
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!");
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteRune(verb);
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(PANIC=");
			p.panicking = true;
			$r = p.printArg(err, 118); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			p.panicking = false;
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(41);
		/* } */ case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.catchPanic }; } $f.$ptr = $ptr; $f._r = _r; $f.arg = arg; $f.err = err; $f.p = p; $f.v = v; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.catchPanic = function(arg, verb) { return this.$val.catchPanic(arg, verb); };
	pp.ptr.prototype.handleMethods = function(verb) {
		var $ptr, _1, _r, _r$1, _r$2, _ref, _tuple, _tuple$1, formatter, handled, ok, ok$1, p, stringer, v, v$1, verb, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; formatter = $f.formatter; handled = $f.handled; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; stringer = $f.stringer; v = $f.v; v$1 = $f.v$1; verb = $f.verb; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		handled = false;
		p = this;
		if (p.erroring) {
			$s = -1; return handled;
			return handled;
		}
		_tuple = $assertType(p.arg, Formatter, true);
		formatter = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			handled = true;
			$deferred.push([$methodVal(p, "catchPanic"), [p.arg, verb]]);
			$r = formatter.Format(p, verb); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return handled;
			return handled;
		/* } */ case 2:
		/* */ if (p.fmt.fmtFlags.sharpV) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (p.fmt.fmtFlags.sharpV) { */ case 4:
			_tuple$1 = $assertType(p.arg, GoStringer, true);
			stringer = _tuple$1[0];
			ok$1 = _tuple$1[1];
			/* */ if (ok$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (ok$1) { */ case 7:
				handled = true;
				$deferred.push([$methodVal(p, "catchPanic"), [p.arg, verb]]);
				_r = stringer.GoString(); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$r = p.fmt.fmt_s(_r); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return handled;
				return handled;
			/* } */ case 8:
			$s = 6; continue;
		/* } else { */ case 5:
				_1 = verb;
				/* */ if ((_1 === (118)) || (_1 === (115)) || (_1 === (120)) || (_1 === (88)) || (_1 === (113))) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if ((_1 === (118)) || (_1 === (115)) || (_1 === (120)) || (_1 === (88)) || (_1 === (113))) { */ case 12:
					_ref = p.arg;
					/* */ if ($assertType(_ref, $error, true)[1]) { $s = 14; continue; }
					/* */ if ($assertType(_ref, Stringer, true)[1]) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if ($assertType(_ref, $error, true)[1]) { */ case 14:
						v = _ref;
						handled = true;
						$deferred.push([$methodVal(p, "catchPanic"), [p.arg, verb]]);
						_r$1 = v.Error(); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						$r = p.fmtString(_r$1, verb); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = -1; return handled;
						return handled;
					/* } else if ($assertType(_ref, Stringer, true)[1]) { */ case 15:
						v$1 = _ref;
						handled = true;
						$deferred.push([$methodVal(p, "catchPanic"), [p.arg, verb]]);
						_r$2 = v$1.String(); /* */ $s = 19; case 19: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						$r = p.fmtString(_r$2, verb); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = -1; return handled;
						return handled;
					/* } */ case 16:
				/* } */ case 13:
			case 11:
		/* } */ case 6:
		handled = false;
		$s = -1; return handled;
		return handled;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  handled; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: pp.ptr.prototype.handleMethods }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.formatter = formatter; $f.handled = handled; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.stringer = stringer; $f.v = v; $f.v$1 = v$1; $f.verb = verb; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	pp.prototype.handleMethods = function(verb) { return this.$val.handleMethods(verb); };
	pp.ptr.prototype.printArg = function(arg, verb) {
		var $ptr, _1, _2, _r, _r$1, _r$2, _r$3, _ref, arg, f, f$1, f$10, f$11, f$12, f$13, f$14, f$15, f$16, f$17, f$18, f$19, f$2, f$3, f$4, f$5, f$6, f$7, f$8, f$9, p, verb, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; arg = $f.arg; f = $f.f; f$1 = $f.f$1; f$10 = $f.f$10; f$11 = $f.f$11; f$12 = $f.f$12; f$13 = $f.f$13; f$14 = $f.f$14; f$15 = $f.f$15; f$16 = $f.f$16; f$17 = $f.f$17; f$18 = $f.f$18; f$19 = $f.f$19; f$2 = $f.f$2; f$3 = $f.f$3; f$4 = $f.f$4; f$5 = $f.f$5; f$6 = $f.f$6; f$7 = $f.f$7; f$8 = $f.f$8; f$9 = $f.f$9; p = $f.p; verb = $f.verb; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		p.arg = arg;
		p.value = new reflect.Value.ptr(ptrType.nil, 0, 0);
		/* */ if ($interfaceIsEqual(arg, $ifaceNil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($interfaceIsEqual(arg, $ifaceNil)) { */ case 1:
				_1 = verb;
				/* */ if ((_1 === (84)) || (_1 === (118))) { $s = 4; continue; }
				/* */ $s = 5; continue;
				/* if ((_1 === (84)) || (_1 === (118))) { */ case 4:
					p.fmt.padString("<nil>");
					$s = 6; continue;
				/* } else { */ case 5:
					$r = p.badVerb(verb); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 6:
			case 3:
			$s = -1; return;
			return;
		/* } */ case 2:
			_2 = verb;
			/* */ if (_2 === (84)) { $s = 9; continue; }
			/* */ if (_2 === (112)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (_2 === (84)) { */ case 9:
				_r = reflect.TypeOf(arg).String(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$r = p.fmt.fmt_s(_r); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } else if (_2 === (112)) { */ case 10:
				_r$1 = reflect.ValueOf(arg); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				$r = p.fmtPointer(_r$1, 112); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } */ case 11:
		case 8:
		_ref = arg;
		/* */ if ($assertType(_ref, $Bool, true)[1]) { $s = 16; continue; }
		/* */ if ($assertType(_ref, $Float32, true)[1]) { $s = 17; continue; }
		/* */ if ($assertType(_ref, $Float64, true)[1]) { $s = 18; continue; }
		/* */ if ($assertType(_ref, $Complex64, true)[1]) { $s = 19; continue; }
		/* */ if ($assertType(_ref, $Complex128, true)[1]) { $s = 20; continue; }
		/* */ if ($assertType(_ref, $Int, true)[1]) { $s = 21; continue; }
		/* */ if ($assertType(_ref, $Int8, true)[1]) { $s = 22; continue; }
		/* */ if ($assertType(_ref, $Int16, true)[1]) { $s = 23; continue; }
		/* */ if ($assertType(_ref, $Int32, true)[1]) { $s = 24; continue; }
		/* */ if ($assertType(_ref, $Int64, true)[1]) { $s = 25; continue; }
		/* */ if ($assertType(_ref, $Uint, true)[1]) { $s = 26; continue; }
		/* */ if ($assertType(_ref, $Uint8, true)[1]) { $s = 27; continue; }
		/* */ if ($assertType(_ref, $Uint16, true)[1]) { $s = 28; continue; }
		/* */ if ($assertType(_ref, $Uint32, true)[1]) { $s = 29; continue; }
		/* */ if ($assertType(_ref, $Uint64, true)[1]) { $s = 30; continue; }
		/* */ if ($assertType(_ref, $Uintptr, true)[1]) { $s = 31; continue; }
		/* */ if ($assertType(_ref, $String, true)[1]) { $s = 32; continue; }
		/* */ if ($assertType(_ref, sliceType$2, true)[1]) { $s = 33; continue; }
		/* */ if ($assertType(_ref, reflect.Value, true)[1]) { $s = 34; continue; }
		/* */ $s = 35; continue;
		/* if ($assertType(_ref, $Bool, true)[1]) { */ case 16:
			f = _ref.$val;
			$r = p.fmtBool(f, verb); /* */ $s = 37; case 37: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Float32, true)[1]) { */ case 17:
			f$1 = _ref.$val;
			$r = p.fmtFloat(f$1, 32, verb); /* */ $s = 38; case 38: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Float64, true)[1]) { */ case 18:
			f$2 = _ref.$val;
			$r = p.fmtFloat(f$2, 64, verb); /* */ $s = 39; case 39: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Complex64, true)[1]) { */ case 19:
			f$3 = _ref.$val;
			$r = p.fmtComplex(new $Complex128(f$3.$real, f$3.$imag), 64, verb); /* */ $s = 40; case 40: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Complex128, true)[1]) { */ case 20:
			f$4 = _ref.$val;
			$r = p.fmtComplex(f$4, 128, verb); /* */ $s = 41; case 41: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Int, true)[1]) { */ case 21:
			f$5 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$5), true, verb); /* */ $s = 42; case 42: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Int8, true)[1]) { */ case 22:
			f$6 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$6), true, verb); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Int16, true)[1]) { */ case 23:
			f$7 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$7), true, verb); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Int32, true)[1]) { */ case 24:
			f$8 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$8), true, verb); /* */ $s = 45; case 45: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Int64, true)[1]) { */ case 25:
			f$9 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(f$9.$high, f$9.$low), true, verb); /* */ $s = 46; case 46: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uint, true)[1]) { */ case 26:
			f$10 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$10), false, verb); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uint8, true)[1]) { */ case 27:
			f$11 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$11), false, verb); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uint16, true)[1]) { */ case 28:
			f$12 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$12), false, verb); /* */ $s = 49; case 49: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uint32, true)[1]) { */ case 29:
			f$13 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$13), false, verb); /* */ $s = 50; case 50: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uint64, true)[1]) { */ case 30:
			f$14 = _ref.$val;
			$r = p.fmtInteger(f$14, false, verb); /* */ $s = 51; case 51: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $Uintptr, true)[1]) { */ case 31:
			f$15 = _ref.$val;
			$r = p.fmtInteger(new $Uint64(0, f$15.constructor === Number ? f$15 : 1), false, verb); /* */ $s = 52; case 52: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, $String, true)[1]) { */ case 32:
			f$16 = _ref.$val;
			$r = p.fmtString(f$16, verb); /* */ $s = 53; case 53: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, sliceType$2, true)[1]) { */ case 33:
			f$17 = _ref.$val;
			$r = p.fmtBytes(f$17, verb, "[]byte"); /* */ $s = 54; case 54: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else if ($assertType(_ref, reflect.Value, true)[1]) { */ case 34:
			f$18 = _ref.$val;
			$r = p.printValue(f$18, verb, 0); /* */ $s = 55; case 55: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 36; continue;
		/* } else { */ case 35:
			f$19 = _ref;
			_r$2 = p.handleMethods(verb); /* */ $s = 58; case 58: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (!_r$2) { $s = 56; continue; }
			/* */ $s = 57; continue;
			/* if (!_r$2) { */ case 56:
				_r$3 = reflect.ValueOf(f$19); /* */ $s = 59; case 59: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				$r = p.printValue(_r$3, verb, 0); /* */ $s = 60; case 60: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 57:
		/* } */ case 36:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.printArg }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f.arg = arg; $f.f = f; $f.f$1 = f$1; $f.f$10 = f$10; $f.f$11 = f$11; $f.f$12 = f$12; $f.f$13 = f$13; $f.f$14 = f$14; $f.f$15 = f$15; $f.f$16 = f$16; $f.f$17 = f$17; $f.f$18 = f$18; $f.f$19 = f$19; $f.f$2 = f$2; $f.f$3 = f$3; $f.f$4 = f$4; $f.f$5 = f$5; $f.f$6 = f$6; $f.f$7 = f$7; $f.f$8 = f$8; $f.f$9 = f$9; $f.p = p; $f.verb = verb; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.printArg = function(arg, verb) { return this.$val.printArg(arg, verb); };
	pp.ptr.prototype.printValue = function(value, verb, depth) {
		var $ptr, _1, _2, _3, _4, _arg, _arg$1, _arg$2, _i, _i$1, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$20, _r$21, _r$22, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, a, bytes, depth, f, i, i$1, i$2, i$3, i$4, key, keys, name, p, t, value, value$1, verb, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$20 = $f._r$20; _r$21 = $f._r$21; _r$22 = $f._r$22; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; a = $f.a; bytes = $f.bytes; depth = $f.depth; f = $f.f; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; i$4 = $f.i$4; key = $f.key; keys = $f.keys; name = $f.name; p = $f.p; t = $f.t; value = $f.value; value$1 = $f.value$1; verb = $f.verb; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		value = value;
		p = this;
		/* */ if (depth > 0 && value.IsValid() && value.CanInterface()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (depth > 0 && value.IsValid() && value.CanInterface()) { */ case 1:
			_r = value.Interface(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			p.arg = _r;
			_r$1 = p.handleMethods(verb); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (_r$1) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_r$1) { */ case 4:
				$s = -1; return;
				return;
			/* } */ case 5:
		/* } */ case 2:
		p.arg = $ifaceNil;
		p.value = value;
			f = value;
			_1 = value.Kind();
			/* */ if (_1 === (0)) { $s = 8; continue; }
			/* */ if (_1 === (1)) { $s = 9; continue; }
			/* */ if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { $s = 10; continue; }
			/* */ if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { $s = 11; continue; }
			/* */ if (_1 === (13)) { $s = 12; continue; }
			/* */ if (_1 === (14)) { $s = 13; continue; }
			/* */ if (_1 === (15)) { $s = 14; continue; }
			/* */ if (_1 === (16)) { $s = 15; continue; }
			/* */ if (_1 === (24)) { $s = 16; continue; }
			/* */ if (_1 === (21)) { $s = 17; continue; }
			/* */ if (_1 === (25)) { $s = 18; continue; }
			/* */ if (_1 === (20)) { $s = 19; continue; }
			/* */ if ((_1 === (17)) || (_1 === (23))) { $s = 20; continue; }
			/* */ if (_1 === (22)) { $s = 21; continue; }
			/* */ if ((_1 === (18)) || (_1 === (19)) || (_1 === (26))) { $s = 22; continue; }
			/* */ $s = 23; continue;
			/* if (_1 === (0)) { */ case 8:
				/* */ if (depth === 0) { $s = 25; continue; }
				/* */ $s = 26; continue;
				/* if (depth === 0) { */ case 25:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<invalid reflect.Value>");
					$s = 27; continue;
				/* } else { */ case 26:
						_2 = verb;
						/* */ if (_2 === (118)) { $s = 29; continue; }
						/* */ $s = 30; continue;
						/* if (_2 === (118)) { */ case 29:
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
							$s = 31; continue;
						/* } else { */ case 30:
							$r = p.badVerb(verb); /* */ $s = 32; case 32: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						/* } */ case 31:
					case 28:
				/* } */ case 27:
				$s = 24; continue;
			/* } else if (_1 === (1)) { */ case 9:
				$r = p.fmtBool(f.Bool(), verb); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { */ case 10:
				$r = p.fmtInteger((x = f.Int(), new $Uint64(x.$high, x.$low)), true, verb); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { */ case 11:
				$r = p.fmtInteger(f.Uint(), false, verb); /* */ $s = 35; case 35: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (13)) { */ case 12:
				$r = p.fmtFloat(f.Float(), 32, verb); /* */ $s = 36; case 36: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (14)) { */ case 13:
				$r = p.fmtFloat(f.Float(), 64, verb); /* */ $s = 37; case 37: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (15)) { */ case 14:
				$r = p.fmtComplex(f.Complex(), 64, verb); /* */ $s = 38; case 38: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (16)) { */ case 15:
				$r = p.fmtComplex(f.Complex(), 128, verb); /* */ $s = 39; case 39: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (24)) { */ case 16:
				_r$2 = f.String(); /* */ $s = 40; case 40: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$r = p.fmtString(_r$2, verb); /* */ $s = 41; case 41: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if (_1 === (21)) { */ case 17:
				/* */ if (p.fmt.fmtFlags.sharpV) { $s = 42; continue; }
				/* */ $s = 43; continue;
				/* if (p.fmt.fmtFlags.sharpV) { */ case 42:
					_r$3 = f.Type().String(); /* */ $s = 45; case 45: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$3); /* */ $s = 46; case 46: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					if (f.IsNil()) {
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(nil)");
						$s = -1; return;
						return;
					}
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(123);
					$s = 44; continue;
				/* } else { */ case 43:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("map[");
				/* } */ case 44:
				_r$4 = f.MapKeys(); /* */ $s = 47; case 47: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
				keys = _r$4;
				_ref = keys;
				_i = 0;
				/* while (true) { */ case 48:
					/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 49; continue; }
					i = _i;
					key = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
					if (i > 0) {
						if (p.fmt.fmtFlags.sharpV) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(", ");
						} else {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
						}
					}
					$r = p.printValue(key, verb, depth + 1 >> 0); /* */ $s = 50; case 50: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(58);
					_r$5 = f.MapIndex(key); /* */ $s = 51; case 51: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					$r = p.printValue(_r$5, verb, depth + 1 >> 0); /* */ $s = 52; case 52: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					_i++;
				/* } */ $s = 48; continue; case 49:
				if (p.fmt.fmtFlags.sharpV) {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(125);
				} else {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(93);
				}
				$s = 24; continue;
			/* } else if (_1 === (25)) { */ case 18:
				/* */ if (p.fmt.fmtFlags.sharpV) { $s = 53; continue; }
				/* */ $s = 54; continue;
				/* if (p.fmt.fmtFlags.sharpV) { */ case 53:
					_r$6 = f.Type().String(); /* */ $s = 55; case 55: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$6); /* */ $s = 56; case 56: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 54:
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(123);
				i$1 = 0;
				/* while (true) { */ case 57:
					/* if (!(i$1 < f.NumField())) { break; } */ if(!(i$1 < f.NumField())) { $s = 58; continue; }
					if (i$1 > 0) {
						if (p.fmt.fmtFlags.sharpV) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(", ");
						} else {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
						}
					}
					/* */ if (p.fmt.fmtFlags.plusV || p.fmt.fmtFlags.sharpV) { $s = 59; continue; }
					/* */ $s = 60; continue;
					/* if (p.fmt.fmtFlags.plusV || p.fmt.fmtFlags.sharpV) { */ case 59:
						_r$7 = f.Type().Field(i$1); /* */ $s = 61; case 61: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
						name = _r$7.Name;
						if (!(name === "")) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(name);
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(58);
						}
					/* } */ case 60:
					_r$8 = getField(f, i$1); /* */ $s = 62; case 62: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
					$r = p.printValue(_r$8, verb, depth + 1 >> 0); /* */ $s = 63; case 63: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					i$1 = i$1 + (1) >> 0;
				/* } */ $s = 57; continue; case 58:
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(125);
				$s = 24; continue;
			/* } else if (_1 === (20)) { */ case 19:
				_r$9 = f.Elem(); /* */ $s = 64; case 64: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
				value$1 = _r$9;
				/* */ if (!value$1.IsValid()) { $s = 65; continue; }
				/* */ $s = 66; continue;
				/* if (!value$1.IsValid()) { */ case 65:
					/* */ if (p.fmt.fmtFlags.sharpV) { $s = 68; continue; }
					/* */ $s = 69; continue;
					/* if (p.fmt.fmtFlags.sharpV) { */ case 68:
						_r$10 = f.Type().String(); /* */ $s = 71; case 71: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
						$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$10); /* */ $s = 72; case 72: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(nil)");
						$s = 70; continue;
					/* } else { */ case 69:
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
					/* } */ case 70:
					$s = 67; continue;
				/* } else { */ case 66:
					$r = p.printValue(value$1, verb, depth + 1 >> 0); /* */ $s = 73; case 73: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 67:
				$s = 24; continue;
			/* } else if ((_1 === (17)) || (_1 === (23))) { */ case 20:
					_3 = verb;
					/* */ if ((_3 === (115)) || (_3 === (113)) || (_3 === (120)) || (_3 === (88))) { $s = 75; continue; }
					/* */ $s = 76; continue;
					/* if ((_3 === (115)) || (_3 === (113)) || (_3 === (120)) || (_3 === (88))) { */ case 75:
						t = f.Type();
						_r$11 = t.Elem(); /* */ $s = 79; case 79: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
						_r$12 = _r$11.Kind(); /* */ $s = 80; case 80: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
						/* */ if (_r$12 === 8) { $s = 77; continue; }
						/* */ $s = 78; continue;
						/* if (_r$12 === 8) { */ case 77:
							bytes = sliceType$2.nil;
							/* */ if (f.Kind() === 23) { $s = 81; continue; }
							/* */ if (f.CanAddr()) { $s = 82; continue; }
							/* */ $s = 83; continue;
							/* if (f.Kind() === 23) { */ case 81:
								_r$13 = f.Bytes(); /* */ $s = 85; case 85: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
								bytes = _r$13;
								$s = 84; continue;
							/* } else if (f.CanAddr()) { */ case 82:
								_r$14 = f.Slice(0, f.Len()); /* */ $s = 86; case 86: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
								_r$15 = _r$14.Bytes(); /* */ $s = 87; case 87: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
								bytes = _r$15;
								$s = 84; continue;
							/* } else { */ case 83:
								bytes = $makeSlice(sliceType$2, f.Len());
								_ref$1 = bytes;
								_i$1 = 0;
								/* while (true) { */ case 88:
									/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 89; continue; }
									i$2 = _i$1;
									_r$16 = f.Index(i$2); /* */ $s = 90; case 90: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
									_r$17 = _r$16.Uint(); /* */ $s = 91; case 91: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
									((i$2 < 0 || i$2 >= bytes.$length) ? $throwRuntimeError("index out of range") : bytes.$array[bytes.$offset + i$2] = (_r$17.$low << 24 >>> 24));
									_i$1++;
								/* } */ $s = 88; continue; case 89:
							/* } */ case 84:
							_arg = bytes;
							_arg$1 = verb;
							_r$18 = t.String(); /* */ $s = 92; case 92: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
							_arg$2 = _r$18;
							$r = p.fmtBytes(_arg, _arg$1, _arg$2); /* */ $s = 93; case 93: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = -1; return;
							return;
						/* } */ case 78:
					/* } */ case 76:
				case 74:
				/* */ if (p.fmt.fmtFlags.sharpV) { $s = 94; continue; }
				/* */ $s = 95; continue;
				/* if (p.fmt.fmtFlags.sharpV) { */ case 94:
					_r$19 = f.Type().String(); /* */ $s = 97; case 97: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
					$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$19); /* */ $s = 98; case 98: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* */ if ((f.Kind() === 23) && f.IsNil()) { $s = 99; continue; }
					/* */ $s = 100; continue;
					/* if ((f.Kind() === 23) && f.IsNil()) { */ case 99:
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(nil)");
						$s = -1; return;
						return;
					/* } else { */ case 100:
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(123);
						i$3 = 0;
						/* while (true) { */ case 102:
							/* if (!(i$3 < f.Len())) { break; } */ if(!(i$3 < f.Len())) { $s = 103; continue; }
							if (i$3 > 0) {
								(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(", ");
							}
							_r$20 = f.Index(i$3); /* */ $s = 104; case 104: if($c) { $c = false; _r$20 = _r$20.$blk(); } if (_r$20 && _r$20.$blk !== undefined) { break s; }
							$r = p.printValue(_r$20, verb, depth + 1 >> 0); /* */ $s = 105; case 105: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							i$3 = i$3 + (1) >> 0;
						/* } */ $s = 102; continue; case 103:
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(125);
					/* } */ case 101:
					$s = 96; continue;
				/* } else { */ case 95:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(91);
					i$4 = 0;
					/* while (true) { */ case 106:
						/* if (!(i$4 < f.Len())) { break; } */ if(!(i$4 < f.Len())) { $s = 107; continue; }
						if (i$4 > 0) {
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
						}
						_r$21 = f.Index(i$4); /* */ $s = 108; case 108: if($c) { $c = false; _r$21 = _r$21.$blk(); } if (_r$21 && _r$21.$blk !== undefined) { break s; }
						$r = p.printValue(_r$21, verb, depth + 1 >> 0); /* */ $s = 109; case 109: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						i$4 = i$4 + (1) >> 0;
					/* } */ $s = 106; continue; case 107:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(93);
				/* } */ case 96:
				$s = 24; continue;
			/* } else if (_1 === (22)) { */ case 21:
				/* */ if ((depth === 0) && !((f.Pointer() === 0))) { $s = 110; continue; }
				/* */ $s = 111; continue;
				/* if ((depth === 0) && !((f.Pointer() === 0))) { */ case 110:
						_r$22 = f.Elem(); /* */ $s = 113; case 113: if($c) { $c = false; _r$22 = _r$22.$blk(); } if (_r$22 && _r$22.$blk !== undefined) { break s; }
						a = _r$22;
						_4 = a.Kind();
						/* */ if ((_4 === (17)) || (_4 === (23)) || (_4 === (25)) || (_4 === (21))) { $s = 114; continue; }
						/* */ $s = 115; continue;
						/* if ((_4 === (17)) || (_4 === (23)) || (_4 === (25)) || (_4 === (21))) { */ case 114:
							(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(38);
							$r = p.printValue(a, verb, depth + 1 >> 0); /* */ $s = 116; case 116: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = -1; return;
							return;
						/* } */ case 115:
					case 112:
				/* } */ case 111:
				$r = p.fmtPointer(f, verb); /* */ $s = 117; case 117: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else if ((_1 === (18)) || (_1 === (19)) || (_1 === (26))) { */ case 22:
				$r = p.fmtPointer(f, verb); /* */ $s = 118; case 118: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 24; continue;
			/* } else { */ case 23:
				$r = p.unknownType(f); /* */ $s = 119; case 119: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 24:
		case 7:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.printValue }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$20 = _r$20; $f._r$21 = _r$21; $f._r$22 = _r$22; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f.a = a; $f.bytes = bytes; $f.depth = depth; $f.f = f; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.i$4 = i$4; $f.key = key; $f.keys = keys; $f.name = name; $f.p = p; $f.t = t; $f.value = value; $f.value$1 = value$1; $f.verb = verb; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.printValue = function(value, verb, depth) { return this.$val.printValue(value, verb, depth); };
	intFromArg = function(a, argNum) {
		var $ptr, _1, _r, _tuple, a, argNum, isInt, n, n$1, newArgNum, num, v, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _tuple = $f._tuple; a = $f.a; argNum = $f.argNum; isInt = $f.isInt; n = $f.n; n$1 = $f.n$1; newArgNum = $f.newArgNum; num = $f.num; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		num = 0;
		isInt = false;
		newArgNum = 0;
		newArgNum = argNum;
		/* */ if (argNum < a.$length) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (argNum < a.$length) { */ case 1:
			_tuple = $assertType(((argNum < 0 || argNum >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + argNum]), $Int, true);
			num = _tuple[0];
			isInt = _tuple[1];
			/* */ if (!isInt) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!isInt) { */ case 3:
					_r = reflect.ValueOf(((argNum < 0 || argNum >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + argNum])); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					_1 = v.Kind();
					if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) {
						n = v.Int();
						if ((x = new $Int64(0, ((n.$low + ((n.$high >> 31) * 4294967296)) >> 0)), (x.$high === n.$high && x.$low === n.$low))) {
							num = ((n.$low + ((n.$high >> 31) * 4294967296)) >> 0);
							isInt = true;
						}
					} else if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) {
						n$1 = v.Uint();
						if ((x$1 = new $Int64(n$1.$high, n$1.$low), (x$1.$high > 0 || (x$1.$high === 0 && x$1.$low >= 0))) && (x$2 = new $Uint64(0, (n$1.$low >> 0)), (x$2.$high === n$1.$high && x$2.$low === n$1.$low))) {
							num = (n$1.$low >> 0);
							isInt = true;
						}
					}
				case 5:
			/* } */ case 4:
			newArgNum = argNum + 1 >> 0;
			if (tooLarge(num)) {
				num = 0;
				isInt = false;
			}
		/* } */ case 2:
		$s = -1; return [num, isInt, newArgNum];
		return [num, isInt, newArgNum];
		/* */ } return; } if ($f === undefined) { $f = { $blk: intFromArg }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._tuple = _tuple; $f.a = a; $f.argNum = argNum; $f.isInt = isInt; $f.n = n; $f.n$1 = n$1; $f.newArgNum = newArgNum; $f.num = num; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseArgNumber = function(format) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, format, i, index, newi, ok, ok$1, wid, width;
		index = 0;
		wid = 0;
		ok = false;
		if (format.length < 3) {
			_tmp = 0;
			_tmp$1 = 1;
			_tmp$2 = false;
			index = _tmp;
			wid = _tmp$1;
			ok = _tmp$2;
			return [index, wid, ok];
		}
		i = 1;
		while (true) {
			if (!(i < format.length)) { break; }
			if (format.charCodeAt(i) === 93) {
				_tuple = parsenum(format, 1, i);
				width = _tuple[0];
				ok$1 = _tuple[1];
				newi = _tuple[2];
				if (!ok$1 || !((newi === i))) {
					_tmp$3 = 0;
					_tmp$4 = i + 1 >> 0;
					_tmp$5 = false;
					index = _tmp$3;
					wid = _tmp$4;
					ok = _tmp$5;
					return [index, wid, ok];
				}
				_tmp$6 = width - 1 >> 0;
				_tmp$7 = i + 1 >> 0;
				_tmp$8 = true;
				index = _tmp$6;
				wid = _tmp$7;
				ok = _tmp$8;
				return [index, wid, ok];
			}
			i = i + (1) >> 0;
		}
		_tmp$9 = 0;
		_tmp$10 = 1;
		_tmp$11 = false;
		index = _tmp$9;
		wid = _tmp$10;
		ok = _tmp$11;
		return [index, wid, ok];
	};
	pp.ptr.prototype.argNumber = function(argNum, format, i, numArgs) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tuple, argNum, format, found, i, index, newArgNum, newi, numArgs, ok, p, wid;
		newArgNum = 0;
		newi = 0;
		found = false;
		p = this;
		if (format.length <= i || !((format.charCodeAt(i) === 91))) {
			_tmp = argNum;
			_tmp$1 = i;
			_tmp$2 = false;
			newArgNum = _tmp;
			newi = _tmp$1;
			found = _tmp$2;
			return [newArgNum, newi, found];
		}
		p.reordered = true;
		_tuple = parseArgNumber($substring(format, i));
		index = _tuple[0];
		wid = _tuple[1];
		ok = _tuple[2];
		if (ok && 0 <= index && index < numArgs) {
			_tmp$3 = index;
			_tmp$4 = i + wid >> 0;
			_tmp$5 = true;
			newArgNum = _tmp$3;
			newi = _tmp$4;
			found = _tmp$5;
			return [newArgNum, newi, found];
		}
		p.goodArgNum = false;
		_tmp$6 = argNum;
		_tmp$7 = i + wid >> 0;
		_tmp$8 = ok;
		newArgNum = _tmp$6;
		newi = _tmp$7;
		found = _tmp$8;
		return [newArgNum, newi, found];
	};
	pp.prototype.argNumber = function(argNum, format, i, numArgs) { return this.$val.argNumber(argNum, format, i, numArgs); };
	pp.ptr.prototype.badArgNum = function(verb) {
		var $ptr, p, verb;
		p = this;
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!");
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteRune(verb);
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(BADINDEX)");
	};
	pp.prototype.badArgNum = function(verb) { return this.$val.badArgNum(verb); };
	pp.ptr.prototype.missingArg = function(verb) {
		var $ptr, p, verb;
		p = this;
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!");
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteRune(verb);
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("(MISSING)");
	};
	pp.prototype.missingArg = function(verb) { return this.$val.missingArg(verb); };
	pp.ptr.prototype.doPrintf = function(format, a) {
		var $ptr, _1, _i, _r, _r$1, _r$2, _ref, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, a, afterIndex, arg, argNum, c, end, format, i, i$1, lasti, p, verb, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; a = $f.a; afterIndex = $f.afterIndex; arg = $f.arg; argNum = $f.argNum; c = $f.c; end = $f.end; format = $f.format; i = $f.i; i$1 = $f.i$1; lasti = $f.lasti; p = $f.p; verb = $f.verb; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		end = format.length;
		argNum = 0;
		afterIndex = false;
		p.reordered = false;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < end)) { break; } */ if(!(i < end)) { $s = 2; continue; }
			p.goodArgNum = true;
			lasti = i;
			while (true) {
				if (!(i < end && !((format.charCodeAt(i) === 37)))) { break; }
				i = i + (1) >> 0;
			}
			if (i > lasti) {
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString($substring(format, lasti, i));
			}
			if (i >= end) {
				/* break; */ $s = 2; continue;
			}
			i = i + (1) >> 0;
			p.fmt.clearflags();
			/* while (true) { */ case 3:
				/* if (!(i < end)) { break; } */ if(!(i < end)) { $s = 4; continue; }
				c = format.charCodeAt(i);
					_1 = c;
					/* */ if (_1 === (35)) { $s = 6; continue; }
					/* */ if (_1 === (48)) { $s = 7; continue; }
					/* */ if (_1 === (43)) { $s = 8; continue; }
					/* */ if (_1 === (45)) { $s = 9; continue; }
					/* */ if (_1 === (32)) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (_1 === (35)) { */ case 6:
						p.fmt.fmtFlags.sharp = true;
						$s = 12; continue;
					/* } else if (_1 === (48)) { */ case 7:
						p.fmt.fmtFlags.zero = !p.fmt.fmtFlags.minus;
						$s = 12; continue;
					/* } else if (_1 === (43)) { */ case 8:
						p.fmt.fmtFlags.plus = true;
						$s = 12; continue;
					/* } else if (_1 === (45)) { */ case 9:
						p.fmt.fmtFlags.minus = true;
						p.fmt.fmtFlags.zero = false;
						$s = 12; continue;
					/* } else if (_1 === (32)) { */ case 10:
						p.fmt.fmtFlags.space = true;
						$s = 12; continue;
					/* } else { */ case 11:
						/* */ if (97 <= c && c <= 122 && argNum < a.$length) { $s = 13; continue; }
						/* */ $s = 14; continue;
						/* if (97 <= c && c <= 122 && argNum < a.$length) { */ case 13:
							if (c === 118) {
								p.fmt.fmtFlags.sharpV = p.fmt.fmtFlags.sharp;
								p.fmt.fmtFlags.sharp = false;
								p.fmt.fmtFlags.plusV = p.fmt.fmtFlags.plus;
								p.fmt.fmtFlags.plus = false;
							}
							$r = p.printArg(((argNum < 0 || argNum >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + argNum]), (c >> 0)); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							argNum = argNum + (1) >> 0;
							i = i + (1) >> 0;
							/* continue formatLoop; */ $s = 1; continue s;
						/* } */ case 14:
						/* break simpleFormat; */ $s = 4; continue s;
					/* } */ case 12:
				case 5:
				i = i + (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			_tuple = p.argNumber(argNum, format, i, a.$length);
			argNum = _tuple[0];
			i = _tuple[1];
			afterIndex = _tuple[2];
			/* */ if (i < end && (format.charCodeAt(i) === 42)) { $s = 16; continue; }
			/* */ $s = 17; continue;
			/* if (i < end && (format.charCodeAt(i) === 42)) { */ case 16:
				i = i + (1) >> 0;
				_r = intFromArg(a, argNum); /* */ $s = 19; case 19: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple$1 = _r;
				p.fmt.wid = _tuple$1[0];
				p.fmt.fmtFlags.widPresent = _tuple$1[1];
				argNum = _tuple$1[2];
				if (!p.fmt.fmtFlags.widPresent) {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!(BADWIDTH)");
				}
				if (p.fmt.wid < 0) {
					p.fmt.wid = -p.fmt.wid;
					p.fmt.fmtFlags.minus = true;
					p.fmt.fmtFlags.zero = false;
				}
				afterIndex = false;
				$s = 18; continue;
			/* } else { */ case 17:
				_tuple$2 = parsenum(format, i, end);
				p.fmt.wid = _tuple$2[0];
				p.fmt.fmtFlags.widPresent = _tuple$2[1];
				i = _tuple$2[2];
				if (afterIndex && p.fmt.fmtFlags.widPresent) {
					p.goodArgNum = false;
				}
			/* } */ case 18:
			/* */ if ((i + 1 >> 0) < end && (format.charCodeAt(i) === 46)) { $s = 20; continue; }
			/* */ $s = 21; continue;
			/* if ((i + 1 >> 0) < end && (format.charCodeAt(i) === 46)) { */ case 20:
				i = i + (1) >> 0;
				if (afterIndex) {
					p.goodArgNum = false;
				}
				_tuple$3 = p.argNumber(argNum, format, i, a.$length);
				argNum = _tuple$3[0];
				i = _tuple$3[1];
				afterIndex = _tuple$3[2];
				/* */ if (i < end && (format.charCodeAt(i) === 42)) { $s = 22; continue; }
				/* */ $s = 23; continue;
				/* if (i < end && (format.charCodeAt(i) === 42)) { */ case 22:
					i = i + (1) >> 0;
					_r$1 = intFromArg(a, argNum); /* */ $s = 25; case 25: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple$4 = _r$1;
					p.fmt.prec = _tuple$4[0];
					p.fmt.fmtFlags.precPresent = _tuple$4[1];
					argNum = _tuple$4[2];
					if (p.fmt.prec < 0) {
						p.fmt.prec = 0;
						p.fmt.fmtFlags.precPresent = false;
					}
					if (!p.fmt.fmtFlags.precPresent) {
						(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!(BADPREC)");
					}
					afterIndex = false;
					$s = 24; continue;
				/* } else { */ case 23:
					_tuple$5 = parsenum(format, i, end);
					p.fmt.prec = _tuple$5[0];
					p.fmt.fmtFlags.precPresent = _tuple$5[1];
					i = _tuple$5[2];
					if (!p.fmt.fmtFlags.precPresent) {
						p.fmt.prec = 0;
						p.fmt.fmtFlags.precPresent = true;
					}
				/* } */ case 24:
			/* } */ case 21:
			if (!afterIndex) {
				_tuple$6 = p.argNumber(argNum, format, i, a.$length);
				argNum = _tuple$6[0];
				i = _tuple$6[1];
				afterIndex = _tuple$6[2];
			}
			if (i >= end) {
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!(NOVERB)");
				/* break; */ $s = 2; continue;
			}
			_tuple$7 = utf8.DecodeRuneInString($substring(format, i));
			verb = _tuple$7[0];
			w = _tuple$7[1];
			i = i + (w) >> 0;
				/* */ if ((verb === 37)) { $s = 27; continue; }
				/* */ if (!p.goodArgNum) { $s = 28; continue; }
				/* */ if (argNum >= a.$length) { $s = 29; continue; }
				/* */ if ((verb === 118)) { $s = 30; continue; }
				/* */ $s = 31; continue;
				/* if ((verb === 37)) { */ case 27:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(37);
					$s = 32; continue;
				/* } else if (!p.goodArgNum) { */ case 28:
					p.badArgNum(verb);
					$s = 32; continue;
				/* } else if (argNum >= a.$length) { */ case 29:
					p.missingArg(verb);
					$s = 32; continue;
				/* } else if ((verb === 118)) { */ case 30:
					p.fmt.fmtFlags.sharpV = p.fmt.fmtFlags.sharp;
					p.fmt.fmtFlags.sharp = false;
					p.fmt.fmtFlags.plusV = p.fmt.fmtFlags.plus;
					p.fmt.fmtFlags.plus = false;
					$r = p.printArg(((argNum < 0 || argNum >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + argNum]), verb); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					argNum = argNum + (1) >> 0;
					$s = 32; continue;
				/* } else { */ case 31:
					$r = p.printArg(((argNum < 0 || argNum >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + argNum]), verb); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					argNum = argNum + (1) >> 0;
				/* } */ case 32:
			case 26:
		/* } */ $s = 1; continue; case 2:
		/* */ if (!p.reordered && argNum < a.$length) { $s = 35; continue; }
		/* */ $s = 36; continue;
		/* if (!p.reordered && argNum < a.$length) { */ case 35:
			p.fmt.clearflags();
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("%!(EXTRA ");
			_ref = $subslice(a, argNum);
			_i = 0;
			/* while (true) { */ case 37:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 38; continue; }
				i$1 = _i;
				arg = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				if (i$1 > 0) {
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(", ");
				}
				/* */ if ($interfaceIsEqual(arg, $ifaceNil)) { $s = 39; continue; }
				/* */ $s = 40; continue;
				/* if ($interfaceIsEqual(arg, $ifaceNil)) { */ case 39:
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString("<nil>");
					$s = 41; continue;
				/* } else { */ case 40:
					_r$2 = reflect.TypeOf(arg).String(); /* */ $s = 42; case 42: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					$r = (p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteString(_r$2); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(61);
					$r = p.printArg(arg, 118); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 41:
				_i++;
			/* } */ $s = 37; continue; case 38:
			(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(41);
		/* } */ case 36:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.doPrintf }; } $f.$ptr = $ptr; $f._1 = _1; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f.a = a; $f.afterIndex = afterIndex; $f.arg = arg; $f.argNum = argNum; $f.c = c; $f.end = end; $f.format = format; $f.i = i; $f.i$1 = i$1; $f.lasti = lasti; $f.p = p; $f.verb = verb; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.doPrintf = function(format, a) { return this.$val.doPrintf(format, a); };
	pp.ptr.prototype.doPrint = function(a) {
		var $ptr, _i, _r, _ref, _v, a, arg, argNum, isString, p, prevString, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _v = $f._v; a = $f.a; arg = $f.arg; argNum = $f.argNum; isString = $f.isString; p = $f.p; prevString = $f.prevString; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		prevString = false;
		_ref = a;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			argNum = _i;
			arg = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (!(!($interfaceIsEqual(arg, $ifaceNil)))) { _v = false; $s = 3; continue s; }
			_r = reflect.TypeOf(arg).Kind(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r === 24; case 3:
			isString = _v;
			if (argNum > 0 && !isString && !prevString) {
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
			}
			$r = p.printArg(arg, 118); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			prevString = isString;
			_i++;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.doPrint }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._v = _v; $f.a = a; $f.arg = arg; $f.argNum = argNum; $f.isString = isString; $f.p = p; $f.prevString = prevString; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.doPrint = function(a) { return this.$val.doPrint(a); };
	pp.ptr.prototype.doPrintln = function(a) {
		var $ptr, _i, _ref, a, arg, argNum, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _ref = $f._ref; a = $f.a; arg = $f.arg; argNum = $f.argNum; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_ref = a;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			argNum = _i;
			arg = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (argNum > 0) {
				(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(32);
			}
			$r = p.printArg(arg, 118); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_i++;
		/* } */ $s = 1; continue; case 2:
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).WriteByte(10);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: pp.ptr.prototype.doPrintln }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.a = a; $f.arg = arg; $f.argNum = argNum; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	pp.prototype.doPrintln = function(a) { return this.$val.doPrintln(a); };
	ss.ptr.prototype.Read = function(buf) {
		var $ptr, _tmp, _tmp$1, buf, err, n, s;
		n = 0;
		err = $ifaceNil;
		s = this;
		_tmp = 0;
		_tmp$1 = errors.New("ScanState's Read should not be called. Use ReadRune");
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	ss.prototype.Read = function(buf) { return this.$val.Read(buf); };
	ss.ptr.prototype.ReadRune = function() {
		var $ptr, _r, _tuple, err, r, s, size, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; size = $f.size; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		size = 0;
		err = $ifaceNil;
		s = this;
		if (s.atEOF || s.count >= s.ssave.argLimit) {
			err = io.EOF;
			$s = -1; return [r, size, err];
			return [r, size, err];
		}
		_r = s.rs.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		size = _tuple[1];
		err = _tuple[2];
		if ($interfaceIsEqual(err, $ifaceNil)) {
			s.count = s.count + (1) >> 0;
			if (s.ssave.nlIsEnd && (r === 10)) {
				s.atEOF = true;
			}
		} else if ($interfaceIsEqual(err, io.EOF)) {
			s.atEOF = true;
		}
		$s = -1; return [r, size, err];
		return [r, size, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.ReadRune }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.size = size; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	ss.ptr.prototype.Width = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, ok, s, wid;
		wid = 0;
		ok = false;
		s = this;
		if (s.ssave.maxWid === 1073741824) {
			_tmp = 0;
			_tmp$1 = false;
			wid = _tmp;
			ok = _tmp$1;
			return [wid, ok];
		}
		_tmp$2 = s.ssave.maxWid;
		_tmp$3 = true;
		wid = _tmp$2;
		ok = _tmp$3;
		return [wid, ok];
	};
	ss.prototype.Width = function() { return this.$val.Width(); };
	ss.ptr.prototype.getRune = function() {
		var $ptr, _r, _tuple, err, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		s = this;
		_r = s.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			if ($interfaceIsEqual(err, io.EOF)) {
				r = -1;
				$s = -1; return r;
				return r;
			}
			s.error(err);
		}
		$s = -1; return r;
		return r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.getRune }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.getRune = function() { return this.$val.getRune(); };
	ss.ptr.prototype.UnreadRune = function() {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.rs.UnreadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		s.atEOF = false;
		s.count = s.count - (1) >> 0;
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.UnreadRune }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	ss.ptr.prototype.error = function(err) {
		var $ptr, err, s, x;
		s = this;
		$panic((x = new scanError.ptr(err), new x.constructor.elem(x)));
	};
	ss.prototype.error = function(err) { return this.$val.error(err); };
	ss.ptr.prototype.errorString = function(err) {
		var $ptr, err, s, x;
		s = this;
		$panic((x = new scanError.ptr(errors.New(err)), new x.constructor.elem(x)));
	};
	ss.prototype.errorString = function(err) { return this.$val.errorString(err); };
	ss.ptr.prototype.Token = function(skipSpace, f) {
		var $ptr, _r, err, f, s, skipSpace, tok, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; f = $f.f; s = $f.s; skipSpace = $f.skipSpace; tok = $f.tok; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = [err];
		tok = sliceType$2.nil;
		err[0] = $ifaceNil;
		s = this;
		$deferred.push([(function(err) { return function() {
			var $ptr, _tuple, e, ok, se;
			e = $recover();
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tuple = $assertType(e, scanError, true);
				se = $clone(_tuple[0], scanError);
				ok = _tuple[1];
				if (ok) {
					err[0] = se.err;
				} else {
					$panic(e);
				}
			}
		}; })(err), []]);
		if (f === $throwNilPointerError) {
			f = notSpace;
		}
		s.buf = $subslice(s.buf, 0, 0);
		_r = s.token(skipSpace, f); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		tok = _r;
		$s = -1; return [tok, err[0]];
		return [tok, err[0]];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [tok, err[0]]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: ss.ptr.prototype.Token }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.f = f; $f.s = s; $f.skipSpace = skipSpace; $f.tok = tok; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	ss.prototype.Token = function(skipSpace, f) { return this.$val.Token(skipSpace, f); };
	isSpace = function(r) {
		var $ptr, _i, _ref, r, rng, rx;
		if (r >= 65536) {
			return false;
		}
		rx = (r << 16 >>> 16);
		_ref = space;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			rng = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), arrayType$1);
			if (rx < rng[0]) {
				return false;
			}
			if (rx <= rng[1]) {
				return true;
			}
			_i++;
		}
		return false;
	};
	notSpace = function(r) {
		var $ptr, r;
		return !isSpace(r);
	};
	ss.ptr.prototype.SkipSpace = function() {
		var $ptr, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		$r = s.skipSpace(false); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.SkipSpace }; } $f.$ptr = $ptr; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.SkipSpace = function() { return this.$val.SkipSpace(); };
	ss.ptr.prototype.free = function(old) {
		var $ptr, old, s;
		old = $clone(old, ssave);
		s = this;
		if (old.validSave) {
			ssave.copy(s.ssave, old);
			return;
		}
		if (s.buf.$capacity > 1024) {
			return;
		}
		s.buf = $subslice(s.buf, 0, 0);
		s.rs = $ifaceNil;
		ssFree.Put(s);
	};
	ss.prototype.free = function(old) { return this.$val.free(old); };
	ss.ptr.prototype.skipSpace = function(stopAtNewline) {
		var $ptr, _r, _r$1, _r$2, _v, r, s, stopAtNewline, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _v = $f._v; r = $f.r; s = $f.s; stopAtNewline = $f.stopAtNewline; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* while (true) { */ case 1:
			_r = s.getRune(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (r === -1) {
				$s = -1; return;
				return;
			}
			if (!(r === 13)) { _v = false; $s = 6; continue s; }
			_r$1 = s.peek("\n"); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_v = _r$1; case 6:
			/* */ if (_v) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_v) { */ case 4:
				/* continue; */ $s = 1; continue;
			/* } */ case 5:
			/* */ if (r === 10) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (r === 10) { */ case 8:
				if (stopAtNewline) {
					/* break; */ $s = 2; continue;
				}
				if (s.ssave.nlIsSpace) {
					/* continue; */ $s = 1; continue;
				}
				s.errorString("unexpected newline");
				$s = -1; return;
				return;
			/* } */ case 9:
			/* */ if (!isSpace(r)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (!isSpace(r)) { */ case 10:
				_r$2 = s.UnreadRune(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$2;
				/* break; */ $s = 2; continue;
			/* } */ case 11:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.skipSpace }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._v = _v; $f.r = r; $f.s = s; $f.stopAtNewline = stopAtNewline; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.skipSpace = function(stopAtNewline) { return this.$val.skipSpace(stopAtNewline); };
	ss.ptr.prototype.token = function(skipSpace, f) {
		var $ptr, _r, _r$1, _r$2, f, r, s, skipSpace, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; r = $f.r; s = $f.s; skipSpace = $f.skipSpace; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (skipSpace) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (skipSpace) { */ case 1:
			$r = s.skipSpace(false); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* while (true) { */ case 4:
			_r = s.getRune(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (r === -1) {
				/* break; */ $s = 5; continue;
			}
			_r$1 = f(r); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!_r$1) { */ case 7:
				_r$2 = s.UnreadRune(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$2;
				/* break; */ $s = 5; continue;
			/* } */ case 8:
			(s.$ptr_buf || (s.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, s))).WriteRune(r);
		/* } */ $s = 4; continue; case 5:
		$s = -1; return (x = s.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length));
		return (x = s.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length));
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.token }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.r = r; $f.s = s; $f.skipSpace = skipSpace; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.token = function(skipSpace, f) { return this.$val.token(skipSpace, f); };
	indexRune = function(s, r) {
		var $ptr, _i, _ref, _rune, c, i, r, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			if (c === r) {
				return i;
			}
			_i += _rune[1];
		}
		return -1;
	};
	ss.ptr.prototype.peek = function(ok) {
		var $ptr, _r, _r$1, ok, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; ok = $f.ok; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.getRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		r = _r;
		/* */ if (!((r === -1))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === -1))) { */ case 2:
			_r$1 = s.UnreadRune(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$1;
		/* } */ case 3:
		$s = -1; return indexRune(ok, r) >= 0;
		return indexRune(ok, r) >= 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.peek }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.ok = ok; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.peek = function(ok) { return this.$val.peek(ok); };
	ptrType$25.methods = [{prop: "clearflags", name: "clearflags", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "init", name: "init", pkg: "fmt", typ: $funcType([ptrType$1], [], false)}, {prop: "writePadding", name: "writePadding", pkg: "fmt", typ: $funcType([$Int], [], false)}, {prop: "pad", name: "pad", pkg: "fmt", typ: $funcType([sliceType$2], [], false)}, {prop: "padString", name: "padString", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_boolean", name: "fmt_boolean", pkg: "fmt", typ: $funcType([$Bool], [], false)}, {prop: "fmt_unicode", name: "fmt_unicode", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_integer", name: "fmt_integer", pkg: "fmt", typ: $funcType([$Uint64, $Int, $Bool, $String], [], false)}, {prop: "truncate", name: "truncate", pkg: "fmt", typ: $funcType([$String], [$String], false)}, {prop: "fmt_s", name: "fmt_s", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_sbx", name: "fmt_sbx", pkg: "fmt", typ: $funcType([$String, sliceType$2, $String], [], false)}, {prop: "fmt_sx", name: "fmt_sx", pkg: "fmt", typ: $funcType([$String, $String], [], false)}, {prop: "fmt_bx", name: "fmt_bx", pkg: "fmt", typ: $funcType([sliceType$2, $String], [], false)}, {prop: "fmt_q", name: "fmt_q", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_c", name: "fmt_c", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_qc", name: "fmt_qc", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_float", name: "fmt_float", pkg: "fmt", typ: $funcType([$Float64, $Int, $Int32, $Int], [], false)}];
	ptrType$1.methods = [{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$2], [], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [], false)}];
	ptrType$2.methods = [{prop: "free", name: "free", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Precision", name: "Precision", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Flag", name: "Flag", pkg: "", typ: $funcType([$Int], [$Bool], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$2], [$Int, $error], false)}, {prop: "unknownType", name: "unknownType", pkg: "fmt", typ: $funcType([reflect.Value], [], false)}, {prop: "badVerb", name: "badVerb", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "fmtBool", name: "fmtBool", pkg: "fmt", typ: $funcType([$Bool, $Int32], [], false)}, {prop: "fmt0x64", name: "fmt0x64", pkg: "fmt", typ: $funcType([$Uint64, $Bool], [], false)}, {prop: "fmtInteger", name: "fmtInteger", pkg: "fmt", typ: $funcType([$Uint64, $Bool, $Int32], [], false)}, {prop: "fmtFloat", name: "fmtFloat", pkg: "fmt", typ: $funcType([$Float64, $Int, $Int32], [], false)}, {prop: "fmtComplex", name: "fmtComplex", pkg: "fmt", typ: $funcType([$Complex128, $Int, $Int32], [], false)}, {prop: "fmtString", name: "fmtString", pkg: "fmt", typ: $funcType([$String, $Int32], [], false)}, {prop: "fmtBytes", name: "fmtBytes", pkg: "fmt", typ: $funcType([sliceType$2, $Int32, $String], [], false)}, {prop: "fmtPointer", name: "fmtPointer", pkg: "fmt", typ: $funcType([reflect.Value, $Int32], [], false)}, {prop: "catchPanic", name: "catchPanic", pkg: "fmt", typ: $funcType([$emptyInterface, $Int32], [], false)}, {prop: "handleMethods", name: "handleMethods", pkg: "fmt", typ: $funcType([$Int32], [$Bool], false)}, {prop: "printArg", name: "printArg", pkg: "fmt", typ: $funcType([$emptyInterface, $Int32], [], false)}, {prop: "printValue", name: "printValue", pkg: "fmt", typ: $funcType([reflect.Value, $Int32, $Int], [], false)}, {prop: "argNumber", name: "argNumber", pkg: "fmt", typ: $funcType([$Int, $String, $Int, $Int], [$Int, $Int, $Bool], false)}, {prop: "badArgNum", name: "badArgNum", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "missingArg", name: "missingArg", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "doPrintf", name: "doPrintf", pkg: "fmt", typ: $funcType([$String, sliceType], [], false)}, {prop: "doPrint", name: "doPrint", pkg: "fmt", typ: $funcType([sliceType], [], false)}, {prop: "doPrintln", name: "doPrintln", pkg: "fmt", typ: $funcType([sliceType], [], false)}];
	ptrType$5.methods = [{prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$2], [$Int, $error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "getRune", name: "getRune", pkg: "fmt", typ: $funcType([], [$Int32], false)}, {prop: "mustReadRune", name: "mustReadRune", pkg: "fmt", typ: $funcType([], [$Int32], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "error", name: "error", pkg: "fmt", typ: $funcType([$error], [], false)}, {prop: "errorString", name: "errorString", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "Token", name: "Token", pkg: "", typ: $funcType([$Bool, funcType], [sliceType$2, $error], false)}, {prop: "SkipSpace", name: "SkipSpace", pkg: "", typ: $funcType([], [], false)}, {prop: "free", name: "free", pkg: "fmt", typ: $funcType([ssave], [], false)}, {prop: "skipSpace", name: "skipSpace", pkg: "fmt", typ: $funcType([$Bool], [], false)}, {prop: "token", name: "token", pkg: "fmt", typ: $funcType([$Bool, funcType], [sliceType$2], false)}, {prop: "consume", name: "consume", pkg: "fmt", typ: $funcType([$String, $Bool], [$Bool], false)}, {prop: "peek", name: "peek", pkg: "fmt", typ: $funcType([$String], [$Bool], false)}, {prop: "notEOF", name: "notEOF", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "accept", name: "accept", pkg: "fmt", typ: $funcType([$String], [$Bool], false)}, {prop: "okVerb", name: "okVerb", pkg: "fmt", typ: $funcType([$Int32, $String, $String], [$Bool], false)}, {prop: "scanBool", name: "scanBool", pkg: "fmt", typ: $funcType([$Int32], [$Bool], false)}, {prop: "getBase", name: "getBase", pkg: "fmt", typ: $funcType([$Int32], [$Int, $String], false)}, {prop: "scanNumber", name: "scanNumber", pkg: "fmt", typ: $funcType([$String, $Bool], [$String], false)}, {prop: "scanRune", name: "scanRune", pkg: "fmt", typ: $funcType([$Int], [$Int64], false)}, {prop: "scanBasePrefix", name: "scanBasePrefix", pkg: "fmt", typ: $funcType([], [$Int, $String, $Bool], false)}, {prop: "scanInt", name: "scanInt", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Int64], false)}, {prop: "scanUint", name: "scanUint", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Uint64], false)}, {prop: "floatToken", name: "floatToken", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "complexTokens", name: "complexTokens", pkg: "fmt", typ: $funcType([], [$String, $String], false)}, {prop: "convertFloat", name: "convertFloat", pkg: "fmt", typ: $funcType([$String, $Int], [$Float64], false)}, {prop: "scanComplex", name: "scanComplex", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Complex128], false)}, {prop: "convertString", name: "convertString", pkg: "fmt", typ: $funcType([$Int32], [$String], false)}, {prop: "quotedString", name: "quotedString", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "hexByte", name: "hexByte", pkg: "fmt", typ: $funcType([], [$Uint8, $Bool], false)}, {prop: "hexString", name: "hexString", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "scanOne", name: "scanOne", pkg: "fmt", typ: $funcType([$Int32, $emptyInterface], [], false)}, {prop: "doScan", name: "doScan", pkg: "fmt", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "advance", name: "advance", pkg: "fmt", typ: $funcType([$String], [$Int], false)}, {prop: "doScanf", name: "doScanf", pkg: "fmt", typ: $funcType([$String, sliceType], [$Int, $error], false)}];
	fmtFlags.init("fmt", [{prop: "widPresent", name: "widPresent", exported: false, typ: $Bool, tag: ""}, {prop: "precPresent", name: "precPresent", exported: false, typ: $Bool, tag: ""}, {prop: "minus", name: "minus", exported: false, typ: $Bool, tag: ""}, {prop: "plus", name: "plus", exported: false, typ: $Bool, tag: ""}, {prop: "sharp", name: "sharp", exported: false, typ: $Bool, tag: ""}, {prop: "space", name: "space", exported: false, typ: $Bool, tag: ""}, {prop: "zero", name: "zero", exported: false, typ: $Bool, tag: ""}, {prop: "plusV", name: "plusV", exported: false, typ: $Bool, tag: ""}, {prop: "sharpV", name: "sharpV", exported: false, typ: $Bool, tag: ""}]);
	fmt.init("fmt", [{prop: "buf", name: "buf", exported: false, typ: ptrType$1, tag: ""}, {prop: "fmtFlags", name: "", exported: false, typ: fmtFlags, tag: ""}, {prop: "wid", name: "wid", exported: false, typ: $Int, tag: ""}, {prop: "prec", name: "prec", exported: false, typ: $Int, tag: ""}, {prop: "intbuf", name: "intbuf", exported: false, typ: arrayType, tag: ""}]);
	State.init([{prop: "Flag", name: "Flag", pkg: "", typ: $funcType([$Int], [$Bool], false)}, {prop: "Precision", name: "Precision", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$2], [$Int, $error], false)}]);
	Formatter.init([{prop: "Format", name: "Format", pkg: "", typ: $funcType([State, $Int32], [], false)}]);
	Stringer.init([{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}]);
	GoStringer.init([{prop: "GoString", name: "GoString", pkg: "", typ: $funcType([], [$String], false)}]);
	buffer.init($Uint8);
	pp.init("fmt", [{prop: "buf", name: "buf", exported: false, typ: buffer, tag: ""}, {prop: "arg", name: "arg", exported: false, typ: $emptyInterface, tag: ""}, {prop: "value", name: "value", exported: false, typ: reflect.Value, tag: ""}, {prop: "fmt", name: "fmt", exported: false, typ: fmt, tag: ""}, {prop: "reordered", name: "reordered", exported: false, typ: $Bool, tag: ""}, {prop: "goodArgNum", name: "goodArgNum", exported: false, typ: $Bool, tag: ""}, {prop: "panicking", name: "panicking", exported: false, typ: $Bool, tag: ""}, {prop: "erroring", name: "erroring", exported: false, typ: $Bool, tag: ""}]);
	scanError.init("fmt", [{prop: "err", name: "err", exported: false, typ: $error, tag: ""}]);
	ss.init("fmt", [{prop: "rs", name: "rs", exported: false, typ: io.RuneScanner, tag: ""}, {prop: "buf", name: "buf", exported: false, typ: buffer, tag: ""}, {prop: "count", name: "count", exported: false, typ: $Int, tag: ""}, {prop: "atEOF", name: "atEOF", exported: false, typ: $Bool, tag: ""}, {prop: "ssave", name: "", exported: false, typ: ssave, tag: ""}]);
	ssave.init("fmt", [{prop: "validSave", name: "validSave", exported: false, typ: $Bool, tag: ""}, {prop: "nlIsEnd", name: "nlIsEnd", exported: false, typ: $Bool, tag: ""}, {prop: "nlIsSpace", name: "nlIsSpace", exported: false, typ: $Bool, tag: ""}, {prop: "argLimit", name: "argLimit", exported: false, typ: $Int, tag: ""}, {prop: "limit", name: "limit", exported: false, typ: $Int, tag: ""}, {prop: "maxWid", name: "maxWid", exported: false, typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = os.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ppFree = new sync.Pool.ptr(0, 0, sliceType.nil, (function() {
			var $ptr;
			return new pp.ptr(buffer.nil, $ifaceNil, new reflect.Value.ptr(ptrType.nil, 0, 0), new fmt.ptr(ptrType$1.nil, new fmtFlags.ptr(false, false, false, false, false, false, false, false, false), 0, 0, arrayType.zero()), false, false, false, false);
		}));
		byteType = reflect.TypeOf(new $Uint8(0));
		space = new sliceType$1([$toNativeArray($kindUint16, [9, 13]), $toNativeArray($kindUint16, [32, 32]), $toNativeArray($kindUint16, [133, 133]), $toNativeArray($kindUint16, [160, 160]), $toNativeArray($kindUint16, [5760, 5760]), $toNativeArray($kindUint16, [8192, 8202]), $toNativeArray($kindUint16, [8232, 8233]), $toNativeArray($kindUint16, [8239, 8239]), $toNativeArray($kindUint16, [8287, 8287]), $toNativeArray($kindUint16, [12288, 12288])]);
		ssFree = new sync.Pool.ptr(0, 0, sliceType.nil, (function() {
			var $ptr;
			return new ss.ptr($ifaceNil, buffer.nil, 0, false, new ssave.ptr(false, false, false, 0, 0, 0));
		}));
		complexError = errors.New("syntax error scanning complex number");
		boolError = errors.New("syntax error scanning boolean");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bufio"] = (function() {
	var $pkg = {}, $init, bytes, errors, io, utf8, Reader, sliceType, ptrType, sliceType$1, errNegativeRead, errNegativeWrite, NewReaderSize, NewReader;
	bytes = $packages["bytes"];
	errors = $packages["errors"];
	io = $packages["io"];
	utf8 = $packages["unicode/utf8"];
	Reader = $pkg.Reader = $newType(0, $kindStruct, "bufio.Reader", true, "bufio", true, function(buf_, rd_, r_, w_, err_, lastByte_, lastRuneSize_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType.nil;
			this.rd = $ifaceNil;
			this.r = 0;
			this.w = 0;
			this.err = $ifaceNil;
			this.lastByte = 0;
			this.lastRuneSize = 0;
			return;
		}
		this.buf = buf_;
		this.rd = rd_;
		this.r = r_;
		this.w = w_;
		this.err = err_;
		this.lastByte = lastByte_;
		this.lastRuneSize = lastRuneSize_;
	});
	sliceType = $sliceType($Uint8);
	ptrType = $ptrType(Reader);
	sliceType$1 = $sliceType(sliceType);
	NewReaderSize = function(rd, size) {
		var $ptr, _tuple, b, ok, r, rd, size;
		_tuple = $assertType(rd, ptrType, true);
		b = _tuple[0];
		ok = _tuple[1];
		if (ok && b.buf.$length >= size) {
			return b;
		}
		if (size < 16) {
			size = 16;
		}
		r = new Reader.ptr(sliceType.nil, $ifaceNil, 0, 0, $ifaceNil, 0, 0);
		r.reset($makeSlice(sliceType, size), rd);
		return r;
	};
	$pkg.NewReaderSize = NewReaderSize;
	NewReader = function(rd) {
		var $ptr, rd;
		return NewReaderSize(rd, 4096);
	};
	$pkg.NewReader = NewReader;
	Reader.ptr.prototype.Reset = function(r) {
		var $ptr, b, r;
		b = this;
		b.reset(b.buf, r);
	};
	Reader.prototype.Reset = function(r) { return this.$val.Reset(r); };
	Reader.ptr.prototype.reset = function(buf, r) {
		var $ptr, b, buf, r;
		b = this;
		Reader.copy(b, new Reader.ptr(buf, r, 0, 0, $ifaceNil, -1, -1));
	};
	Reader.prototype.reset = function(buf, r) { return this.$val.reset(buf, r); };
	Reader.ptr.prototype.fill = function() {
		var $ptr, _r, _tuple, b, err, i, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; b = $f.b; err = $f.err; i = $f.i; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		if (b.r > 0) {
			$copySlice(b.buf, $subslice(b.buf, b.r, b.w));
			b.w = b.w - (b.r) >> 0;
			b.r = 0;
		}
		if (b.w >= b.buf.$length) {
			$panic(new $String("bufio: tried to fill full buffer"));
		}
		i = 100;
		/* while (true) { */ case 1:
			/* if (!(i > 0)) { break; } */ if(!(i > 0)) { $s = 2; continue; }
			_r = b.rd.Read($subslice(b.buf, b.w)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			n = _tuple[0];
			err = _tuple[1];
			if (n < 0) {
				$panic(errNegativeRead);
			}
			b.w = b.w + (n) >> 0;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				b.err = err;
				$s = -1; return;
				return;
			}
			if (n > 0) {
				$s = -1; return;
				return;
			}
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		b.err = io.ErrNoProgress;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.fill }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.i = i; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.fill = function() { return this.$val.fill(); };
	Reader.ptr.prototype.readErr = function() {
		var $ptr, b, err;
		b = this;
		err = b.err;
		b.err = $ifaceNil;
		return err;
	};
	Reader.prototype.readErr = function() { return this.$val.readErr(); };
	Reader.ptr.prototype.Peek = function(n) {
		var $ptr, avail, b, err, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; avail = $f.avail; b = $f.b; err = $f.err; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		if (n < 0) {
			$s = -1; return [sliceType.nil, $pkg.ErrNegativeCount];
			return [sliceType.nil, $pkg.ErrNegativeCount];
		}
		/* while (true) { */ case 1:
			/* if (!((b.w - b.r >> 0) < n && (b.w - b.r >> 0) < b.buf.$length && $interfaceIsEqual(b.err, $ifaceNil))) { break; } */ if(!((b.w - b.r >> 0) < n && (b.w - b.r >> 0) < b.buf.$length && $interfaceIsEqual(b.err, $ifaceNil))) { $s = 2; continue; }
			$r = b.fill(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ $s = 1; continue; case 2:
		if (n > b.buf.$length) {
			$s = -1; return [$subslice(b.buf, b.r, b.w), $pkg.ErrBufferFull];
			return [$subslice(b.buf, b.r, b.w), $pkg.ErrBufferFull];
		}
		err = $ifaceNil;
		avail = b.w - b.r >> 0;
		if (avail < n) {
			n = avail;
			err = b.readErr();
			if ($interfaceIsEqual(err, $ifaceNil)) {
				err = $pkg.ErrBufferFull;
			}
		}
		$s = -1; return [$subslice(b.buf, b.r, (b.r + n >> 0)), err];
		return [$subslice(b.buf, b.r, (b.r + n >> 0)), err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.Peek }; } $f.$ptr = $ptr; $f.avail = avail; $f.b = b; $f.err = err; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.Peek = function(n) { return this.$val.Peek(n); };
	Reader.ptr.prototype.Discard = function(n) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, discarded, err, n, remain, skip, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; b = $f.b; discarded = $f.discarded; err = $f.err; n = $f.n; remain = $f.remain; skip = $f.skip; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		discarded = 0;
		err = $ifaceNil;
		b = this;
		if (n < 0) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrNegativeCount;
			discarded = _tmp;
			err = _tmp$1;
			$s = -1; return [discarded, err];
			return [discarded, err];
		}
		if (n === 0) {
			$s = -1; return [discarded, err];
			return [discarded, err];
		}
		remain = n;
		/* while (true) { */ case 1:
			skip = b.Buffered();
			/* */ if (skip === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (skip === 0) { */ case 3:
				$r = b.fill(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				skip = b.Buffered();
			/* } */ case 4:
			if (skip > remain) {
				skip = remain;
			}
			b.r = b.r + (skip) >> 0;
			remain = remain - (skip) >> 0;
			if (remain === 0) {
				_tmp$2 = n;
				_tmp$3 = $ifaceNil;
				discarded = _tmp$2;
				err = _tmp$3;
				$s = -1; return [discarded, err];
				return [discarded, err];
			}
			if (!($interfaceIsEqual(b.err, $ifaceNil))) {
				_tmp$4 = n - remain >> 0;
				_tmp$5 = b.readErr();
				discarded = _tmp$4;
				err = _tmp$5;
				$s = -1; return [discarded, err];
				return [discarded, err];
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [discarded, err];
		return [discarded, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.Discard }; } $f.$ptr = $ptr; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f.b = b; $f.discarded = discarded; $f.err = err; $f.n = n; $f.remain = remain; $f.skip = skip; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.Discard = function(n) { return this.$val.Discard(n); };
	Reader.ptr.prototype.Read = function(p) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, b, err, n, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; b = $f.b; err = $f.err; n = $f.n; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		b = this;
		n = p.$length;
		if (n === 0) {
			_tmp = 0;
			_tmp$1 = b.readErr();
			n = _tmp;
			err = _tmp$1;
			$s = -1; return [n, err];
			return [n, err];
		}
		/* */ if (b.r === b.w) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (b.r === b.w) { */ case 1:
			if (!($interfaceIsEqual(b.err, $ifaceNil))) {
				_tmp$2 = 0;
				_tmp$3 = b.readErr();
				n = _tmp$2;
				err = _tmp$3;
				$s = -1; return [n, err];
				return [n, err];
			}
			/* */ if (p.$length >= b.buf.$length) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (p.$length >= b.buf.$length) { */ case 3:
				_r = b.rd.Read(p); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple = _r;
				n = _tuple[0];
				b.err = _tuple[1];
				if (n < 0) {
					$panic(errNegativeRead);
				}
				if (n > 0) {
					b.lastByte = ((x = n - 1 >> 0, ((x < 0 || x >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x])) >> 0);
					b.lastRuneSize = -1;
				}
				_tmp$4 = n;
				_tmp$5 = b.readErr();
				n = _tmp$4;
				err = _tmp$5;
				$s = -1; return [n, err];
				return [n, err];
			/* } */ case 4:
			$r = b.fill(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			if (b.r === b.w) {
				_tmp$6 = 0;
				_tmp$7 = b.readErr();
				n = _tmp$6;
				err = _tmp$7;
				$s = -1; return [n, err];
				return [n, err];
			}
		/* } */ case 2:
		n = $copySlice(p, $subslice(b.buf, b.r, b.w));
		b.r = b.r + (n) >> 0;
		b.lastByte = ((x$1 = b.buf, x$2 = b.r - 1 >> 0, ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2])) >> 0);
		b.lastRuneSize = -1;
		_tmp$8 = n;
		_tmp$9 = $ifaceNil;
		n = _tmp$8;
		err = _tmp$9;
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.Read }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.n = n; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.Read = function(p) { return this.$val.Read(p); };
	Reader.ptr.prototype.ReadByte = function() {
		var $ptr, b, c, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; c = $f.c; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		b.lastRuneSize = -1;
		/* while (true) { */ case 1:
			/* if (!(b.r === b.w)) { break; } */ if(!(b.r === b.w)) { $s = 2; continue; }
			if (!($interfaceIsEqual(b.err, $ifaceNil))) {
				$s = -1; return [0, b.readErr()];
				return [0, b.readErr()];
			}
			$r = b.fill(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ $s = 1; continue; case 2:
		c = (x = b.buf, x$1 = b.r, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		b.r = b.r + (1) >> 0;
		b.lastByte = (c >> 0);
		$s = -1; return [c, $ifaceNil];
		return [c, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadByte }; } $f.$ptr = $ptr; $f.b = b; $f.c = c; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadByte = function() { return this.$val.ReadByte(); };
	Reader.ptr.prototype.UnreadByte = function() {
		var $ptr, b, x, x$1;
		b = this;
		if (b.lastByte < 0 || (b.r === 0) && b.w > 0) {
			return $pkg.ErrInvalidUnreadByte;
		}
		if (b.r > 0) {
			b.r = b.r - (1) >> 0;
		} else {
			b.w = 1;
		}
		(x = b.buf, x$1 = b.r, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1] = (b.lastByte << 24 >>> 24)));
		b.lastByte = -1;
		b.lastRuneSize = -1;
		return $ifaceNil;
	};
	Reader.prototype.UnreadByte = function() { return this.$val.UnreadByte(); };
	Reader.ptr.prototype.ReadRune = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, b, err, r, size, x, x$1, x$2, x$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; b = $f.b; err = $f.err; r = $f.r; size = $f.size; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		size = 0;
		err = $ifaceNil;
		b = this;
		/* while (true) { */ case 1:
			/* if (!((b.r + 4 >> 0) > b.w && !utf8.FullRune($subslice(b.buf, b.r, b.w)) && $interfaceIsEqual(b.err, $ifaceNil) && (b.w - b.r >> 0) < b.buf.$length)) { break; } */ if(!((b.r + 4 >> 0) > b.w && !utf8.FullRune($subslice(b.buf, b.r, b.w)) && $interfaceIsEqual(b.err, $ifaceNil) && (b.w - b.r >> 0) < b.buf.$length)) { $s = 2; continue; }
			$r = b.fill(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ $s = 1; continue; case 2:
		b.lastRuneSize = -1;
		if (b.r === b.w) {
			_tmp = 0;
			_tmp$1 = 0;
			_tmp$2 = b.readErr();
			r = _tmp;
			size = _tmp$1;
			err = _tmp$2;
			$s = -1; return [r, size, err];
			return [r, size, err];
		}
		_tmp$3 = ((x = b.buf, x$1 = b.r, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) >> 0);
		_tmp$4 = 1;
		r = _tmp$3;
		size = _tmp$4;
		if (r >= 128) {
			_tuple = utf8.DecodeRune($subslice(b.buf, b.r, b.w));
			r = _tuple[0];
			size = _tuple[1];
		}
		b.r = b.r + (size) >> 0;
		b.lastByte = ((x$2 = b.buf, x$3 = b.r - 1 >> 0, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3])) >> 0);
		b.lastRuneSize = size;
		_tmp$5 = r;
		_tmp$6 = size;
		_tmp$7 = $ifaceNil;
		r = _tmp$5;
		size = _tmp$6;
		err = _tmp$7;
		$s = -1; return [r, size, err];
		return [r, size, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadRune }; } $f.$ptr = $ptr; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.r = r; $f.size = size; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	Reader.ptr.prototype.UnreadRune = function() {
		var $ptr, b;
		b = this;
		if (b.lastRuneSize < 0 || b.r < b.lastRuneSize) {
			return $pkg.ErrInvalidUnreadRune;
		}
		b.r = b.r - (b.lastRuneSize) >> 0;
		b.lastByte = -1;
		b.lastRuneSize = -1;
		return $ifaceNil;
	};
	Reader.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	Reader.ptr.prototype.Buffered = function() {
		var $ptr, b;
		b = this;
		return b.w - b.r >> 0;
	};
	Reader.prototype.Buffered = function() { return this.$val.Buffered(); };
	Reader.ptr.prototype.ReadSlice = function(delim) {
		var $ptr, b, delim, err, i, i$1, line, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; b = $f.b; delim = $f.delim; err = $f.err; i = $f.i; i$1 = $f.i$1; line = $f.line; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		/* while (true) { */ case 1:
			i = bytes.IndexByte($subslice(b.buf, b.r, b.w), delim);
			if (i >= 0) {
				line = $subslice(b.buf, b.r, ((b.r + i >> 0) + 1 >> 0));
				b.r = b.r + ((i + 1 >> 0)) >> 0;
				/* break; */ $s = 2; continue;
			}
			if (!($interfaceIsEqual(b.err, $ifaceNil))) {
				line = $subslice(b.buf, b.r, b.w);
				b.r = b.w;
				err = b.readErr();
				/* break; */ $s = 2; continue;
			}
			if (b.Buffered() >= b.buf.$length) {
				b.r = b.w;
				line = b.buf;
				err = $pkg.ErrBufferFull;
				/* break; */ $s = 2; continue;
			}
			$r = b.fill(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ $s = 1; continue; case 2:
		i$1 = line.$length - 1 >> 0;
		if (i$1 >= 0) {
			b.lastByte = (((i$1 < 0 || i$1 >= line.$length) ? $throwRuntimeError("index out of range") : line.$array[line.$offset + i$1]) >> 0);
			b.lastRuneSize = -1;
		}
		$s = -1; return [line, err];
		return [line, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadSlice }; } $f.$ptr = $ptr; $f.b = b; $f.delim = delim; $f.err = err; $f.i = i; $f.i$1 = i$1; $f.line = line; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadSlice = function(delim) { return this.$val.ReadSlice(delim); };
	Reader.ptr.prototype.ReadLine = function() {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tuple, b, drop, err, isPrefix, line, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tuple = $f._tuple; b = $f.b; drop = $f.drop; err = $f.err; isPrefix = $f.isPrefix; line = $f.line; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		line = sliceType.nil;
		isPrefix = false;
		err = $ifaceNil;
		b = this;
		_r = b.ReadSlice(10); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		line = _tuple[0];
		err = _tuple[1];
		if ($interfaceIsEqual(err, $pkg.ErrBufferFull)) {
			if (line.$length > 0 && ((x = line.$length - 1 >> 0, ((x < 0 || x >= line.$length) ? $throwRuntimeError("index out of range") : line.$array[line.$offset + x])) === 13)) {
				if (b.r === 0) {
					$panic(new $String("bufio: tried to rewind past start of buffer"));
				}
				b.r = b.r - (1) >> 0;
				line = $subslice(line, 0, (line.$length - 1 >> 0));
			}
			_tmp = line;
			_tmp$1 = true;
			_tmp$2 = $ifaceNil;
			line = _tmp;
			isPrefix = _tmp$1;
			err = _tmp$2;
			$s = -1; return [line, isPrefix, err];
			return [line, isPrefix, err];
		}
		if (line.$length === 0) {
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				line = sliceType.nil;
			}
			$s = -1; return [line, isPrefix, err];
			return [line, isPrefix, err];
		}
		err = $ifaceNil;
		if ((x$1 = line.$length - 1 >> 0, ((x$1 < 0 || x$1 >= line.$length) ? $throwRuntimeError("index out of range") : line.$array[line.$offset + x$1])) === 10) {
			drop = 1;
			if (line.$length > 1 && ((x$2 = line.$length - 2 >> 0, ((x$2 < 0 || x$2 >= line.$length) ? $throwRuntimeError("index out of range") : line.$array[line.$offset + x$2])) === 13)) {
				drop = 2;
			}
			line = $subslice(line, 0, (line.$length - drop >> 0));
		}
		$s = -1; return [line, isPrefix, err];
		return [line, isPrefix, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadLine }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tuple = _tuple; $f.b = b; $f.drop = drop; $f.err = err; $f.isPrefix = isPrefix; $f.line = line; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadLine = function() { return this.$val.ReadLine(); };
	Reader.ptr.prototype.ReadBytes = function(delim) {
		var $ptr, _i, _i$1, _r, _ref, _ref$1, _tuple, b, buf, buf$1, delim, e, err, frag, full, i, i$1, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _tuple = $f._tuple; b = $f.b; buf = $f.buf; buf$1 = $f.buf$1; delim = $f.delim; e = $f.e; err = $f.err; frag = $f.frag; full = $f.full; i = $f.i; i$1 = $f.i$1; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		frag = sliceType.nil;
		full = sliceType$1.nil;
		err = $ifaceNil;
		/* while (true) { */ case 1:
			e = $ifaceNil;
			_r = b.ReadSlice(delim); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			frag = _tuple[0];
			e = _tuple[1];
			if ($interfaceIsEqual(e, $ifaceNil)) {
				/* break; */ $s = 2; continue;
			}
			if (!($interfaceIsEqual(e, $pkg.ErrBufferFull))) {
				err = e;
				/* break; */ $s = 2; continue;
			}
			buf = $makeSlice(sliceType, frag.$length);
			$copySlice(buf, frag);
			full = $append(full, buf);
		/* } */ $s = 1; continue; case 2:
		n = 0;
		_ref = full;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			n = n + (((i < 0 || i >= full.$length) ? $throwRuntimeError("index out of range") : full.$array[full.$offset + i]).$length) >> 0;
			_i++;
		}
		n = n + (frag.$length) >> 0;
		buf$1 = $makeSlice(sliceType, n);
		n = 0;
		_ref$1 = full;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			n = n + ($copySlice($subslice(buf$1, n), ((i$1 < 0 || i$1 >= full.$length) ? $throwRuntimeError("index out of range") : full.$array[full.$offset + i$1]))) >> 0;
			_i$1++;
		}
		$copySlice($subslice(buf$1, n), frag);
		$s = -1; return [buf$1, err];
		return [buf$1, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadBytes }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tuple = _tuple; $f.b = b; $f.buf = buf; $f.buf$1 = buf$1; $f.delim = delim; $f.e = e; $f.err = err; $f.frag = frag; $f.full = full; $f.i = i; $f.i$1 = i$1; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadBytes = function(delim) { return this.$val.ReadBytes(delim); };
	Reader.ptr.prototype.ReadString = function(delim) {
		var $ptr, _r, _tuple, b, bytes$1, delim, err, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; b = $f.b; bytes$1 = $f.bytes$1; delim = $f.delim; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		_r = b.ReadBytes(delim); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		bytes$1 = _tuple[0];
		err = _tuple[1];
		$s = -1; return [$bytesToString(bytes$1), err];
		return [$bytesToString(bytes$1), err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.ReadString }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.b = b; $f.bytes$1 = bytes$1; $f.delim = delim; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.ReadString = function(delim) { return this.$val.ReadString(delim); };
	Reader.ptr.prototype.WriteTo = function(w) {
		var $ptr, _r, _r$1, _r$2, _r$3, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, b, err, err$1, err$2, err$3, m, m$1, m$2, n, ok, ok$1, r, w, w$1, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; b = $f.b; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; m = $f.m; m$1 = $f.m$1; m$2 = $f.m$2; n = $f.n; ok = $f.ok; ok$1 = $f.ok$1; r = $f.r; w = $f.w; w$1 = $f.w$1; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		_r = b.writeBuf(w); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		n = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [n, err];
			return [n, err];
		}
		_tuple$1 = $assertType(b.rd, io.WriterTo, true);
		r = _tuple$1[0];
		ok = _tuple$1[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = r.WriteTo(w); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$2 = _r$1;
			m = _tuple$2[0];
			err$1 = _tuple$2[1];
			n = (x = m, new $Int64(n.$high + x.$high, n.$low + x.$low));
			_tmp = n;
			_tmp$1 = err$1;
			n = _tmp;
			err = _tmp$1;
			$s = -1; return [n, err];
			return [n, err];
		/* } */ case 3:
		_tuple$3 = $assertType(w, io.ReaderFrom, true);
		w$1 = _tuple$3[0];
		ok$1 = _tuple$3[1];
		/* */ if (ok$1) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (ok$1) { */ case 5:
			_r$2 = w$1.ReadFrom(b.rd); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$4 = _r$2;
			m$1 = _tuple$4[0];
			err$2 = _tuple$4[1];
			n = (x$1 = m$1, new $Int64(n.$high + x$1.$high, n.$low + x$1.$low));
			_tmp$2 = n;
			_tmp$3 = err$2;
			n = _tmp$2;
			err = _tmp$3;
			$s = -1; return [n, err];
			return [n, err];
		/* } */ case 6:
		/* */ if ((b.w - b.r >> 0) < b.buf.$length) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if ((b.w - b.r >> 0) < b.buf.$length) { */ case 8:
			$r = b.fill(); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 9:
		/* while (true) { */ case 11:
			/* if (!(b.r < b.w)) { break; } */ if(!(b.r < b.w)) { $s = 12; continue; }
			_r$3 = b.writeBuf(w); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$5 = _r$3;
			m$2 = _tuple$5[0];
			err$3 = _tuple$5[1];
			n = (x$2 = m$2, new $Int64(n.$high + x$2.$high, n.$low + x$2.$low));
			if (!($interfaceIsEqual(err$3, $ifaceNil))) {
				_tmp$4 = n;
				_tmp$5 = err$3;
				n = _tmp$4;
				err = _tmp$5;
				$s = -1; return [n, err];
				return [n, err];
			}
			$r = b.fill(); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ $s = 11; continue; case 12:
		if ($interfaceIsEqual(b.err, io.EOF)) {
			b.err = $ifaceNil;
		}
		_tmp$6 = n;
		_tmp$7 = b.readErr();
		n = _tmp$6;
		err = _tmp$7;
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.WriteTo }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f.b = b; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.m = m; $f.m$1 = m$1; $f.m$2 = m$2; $f.n = n; $f.ok = ok; $f.ok$1 = ok$1; $f.r = r; $f.w = w; $f.w$1 = w$1; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.WriteTo = function(w) { return this.$val.WriteTo(w); };
	Reader.ptr.prototype.writeBuf = function(w) {
		var $ptr, _r, _tuple, b, err, n, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; b = $f.b; err = $f.err; n = $f.n; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		_r = w.Write($subslice(b.buf, b.r, b.w)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		n = _tuple[0];
		err = _tuple[1];
		if (n < 0) {
			$panic(errNegativeWrite);
		}
		b.r = b.r + (n) >> 0;
		$s = -1; return [new $Int64(0, n), err];
		return [new $Int64(0, n), err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Reader.ptr.prototype.writeBuf }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.n = n; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	Reader.prototype.writeBuf = function(w) { return this.$val.writeBuf(w); };
	ptrType.methods = [{prop: "Reset", name: "Reset", pkg: "", typ: $funcType([io.Reader], [], false)}, {prop: "reset", name: "reset", pkg: "bufio", typ: $funcType([sliceType, io.Reader], [], false)}, {prop: "fill", name: "fill", pkg: "bufio", typ: $funcType([], [], false)}, {prop: "readErr", name: "readErr", pkg: "bufio", typ: $funcType([], [$error], false)}, {prop: "Peek", name: "Peek", pkg: "", typ: $funcType([$Int], [sliceType, $error], false)}, {prop: "Discard", name: "Discard", pkg: "", typ: $funcType([$Int], [$Int, $error], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "ReadByte", name: "ReadByte", pkg: "", typ: $funcType([], [$Uint8, $error], false)}, {prop: "UnreadByte", name: "UnreadByte", pkg: "", typ: $funcType([], [$error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Buffered", name: "Buffered", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ReadSlice", name: "ReadSlice", pkg: "", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "ReadLine", name: "ReadLine", pkg: "", typ: $funcType([], [sliceType, $Bool, $error], false)}, {prop: "ReadBytes", name: "ReadBytes", pkg: "", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "ReadString", name: "ReadString", pkg: "", typ: $funcType([$Uint8], [$String, $error], false)}, {prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([io.Writer], [$Int64, $error], false)}, {prop: "writeBuf", name: "writeBuf", pkg: "bufio", typ: $funcType([io.Writer], [$Int64, $error], false)}];
	Reader.init("bufio", [{prop: "buf", name: "buf", exported: false, typ: sliceType, tag: ""}, {prop: "rd", name: "rd", exported: false, typ: io.Reader, tag: ""}, {prop: "r", name: "r", exported: false, typ: $Int, tag: ""}, {prop: "w", name: "w", exported: false, typ: $Int, tag: ""}, {prop: "err", name: "err", exported: false, typ: $error, tag: ""}, {prop: "lastByte", name: "lastByte", exported: false, typ: $Int, tag: ""}, {prop: "lastRuneSize", name: "lastRuneSize", exported: false, typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = errors.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrInvalidUnreadByte = errors.New("bufio: invalid use of UnreadByte");
		$pkg.ErrInvalidUnreadRune = errors.New("bufio: invalid use of UnreadRune");
		$pkg.ErrBufferFull = errors.New("bufio: buffer full");
		$pkg.ErrNegativeCount = errors.New("bufio: negative count");
		errNegativeRead = errors.New("bufio: reader returned negative count from Read");
		errNegativeWrite = errors.New("bufio: writer returned negative count from Write");
		$pkg.ErrTooLong = errors.New("bufio.Scanner: token too long");
		$pkg.ErrNegativeAdvance = errors.New("bufio.Scanner: SplitFunc returns negative advance count");
		$pkg.ErrAdvanceTooFar = errors.New("bufio.Scanner: SplitFunc returns advance count beyond input");
		$pkg.ErrFinalToken = errors.New("final token");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/jtolds/sheepda"] = (function() {
	var $pkg = {}, $init, bufio, bytes, fmt, io, unicode, byteStream, byteVal, Builtin, Scope, Value, Closure, resultMaps, Expr, LambdaExpr, ApplicationExpr, VariableExpr, assignment, ProgramExpr, Stream, ptrType, sliceType, ptrType$1, sliceType$1, ptrType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, ptrType$8, arrayType, arrayType$1, sliceType$2, ptrType$9, mapType, funcType, mapType$1, funcType$1, ptrType$10, eofValue, churchTrue, churchFalse, nextByte, printByte, readByte, NewScopeWithBuiltins, ChurchNumeral, ChurchPair, ChurchBool, NewScope, NewClosure, eval$1, Eval, IsVariableRune, ParseVariable, ParseLambda, ParseSubexpression, ParseExpr, Parse, NewStream;
	bufio = $packages["bufio"];
	bytes = $packages["bytes"];
	fmt = $packages["fmt"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	byteStream = $pkg.byteStream = $newType(0, $kindStruct, "sheepda.byteStream", true, "github.com/jtolds/sheepda", false, function(in$0_, err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.in$0 = ptrType.nil;
			this.err = $ifaceNil;
			return;
		}
		this.in$0 = in$0_;
		this.err = err_;
	});
	byteVal = $pkg.byteVal = $newType(1, $kindUint8, "sheepda.byteVal", true, "github.com/jtolds/sheepda", false, null);
	Builtin = $pkg.Builtin = $newType(0, $kindStruct, "sheepda.Builtin", true, "github.com/jtolds/sheepda", true, function(Name_, Transform_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.Transform = $throwNilPointerError;
			return;
		}
		this.Name = Name_;
		this.Transform = Transform_;
	});
	Scope = $pkg.Scope = $newType(0, $kindStruct, "sheepda.Scope", true, "github.com/jtolds/sheepda", true, function(Name_, Value_, Parent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.Value = $ifaceNil;
			this.Parent = ptrType$3.nil;
			return;
		}
		this.Name = Name_;
		this.Value = Value_;
		this.Parent = Parent_;
	});
	Value = $pkg.Value = $newType(8, $kindInterface, "sheepda.Value", true, "github.com/jtolds/sheepda", true, null);
	Closure = $pkg.Closure = $newType(0, $kindStruct, "sheepda.Closure", true, "github.com/jtolds/sheepda", true, function(Scope_, Lambda_, memoize_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Scope = ptrType$3.nil;
			this.Lambda = ptrType$2.nil;
			this.memoize = false;
			return;
		}
		this.Scope = Scope_;
		this.Lambda = Lambda_;
		this.memoize = memoize_;
	});
	resultMaps = $pkg.resultMaps = $newType(12, $kindSlice, "sheepda.resultMaps", true, "github.com/jtolds/sheepda", false, null);
	Expr = $pkg.Expr = $newType(8, $kindInterface, "sheepda.Expr", true, "github.com/jtolds/sheepda", true, null);
	LambdaExpr = $pkg.LambdaExpr = $newType(0, $kindStruct, "sheepda.LambdaExpr", true, "github.com/jtolds/sheepda", true, function(Arg_, Body_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Arg = "";
			this.Body = $ifaceNil;
			return;
		}
		this.Arg = Arg_;
		this.Body = Body_;
	});
	ApplicationExpr = $pkg.ApplicationExpr = $newType(0, $kindStruct, "sheepda.ApplicationExpr", true, "github.com/jtolds/sheepda", true, function(Func_, Arg_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Func = $ifaceNil;
			this.Arg = $ifaceNil;
			return;
		}
		this.Func = Func_;
		this.Arg = Arg_;
	});
	VariableExpr = $pkg.VariableExpr = $newType(0, $kindStruct, "sheepda.VariableExpr", true, "github.com/jtolds/sheepda", true, function(Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			return;
		}
		this.Name = Name_;
	});
	assignment = $pkg.assignment = $newType(0, $kindStruct, "sheepda.assignment", true, "github.com/jtolds/sheepda", false, function(LHS_, RHS_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.LHS = "";
			this.RHS = $ifaceNil;
			return;
		}
		this.LHS = LHS_;
		this.RHS = RHS_;
	});
	ProgramExpr = $pkg.ProgramExpr = $newType(0, $kindStruct, "sheepda.ProgramExpr", true, "github.com/jtolds/sheepda", true, function(Expr_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Expr = $ifaceNil;
			return;
		}
		this.Expr = Expr_;
	});
	Stream = $pkg.Stream = $newType(0, $kindStruct, "sheepda.Stream", true, "github.com/jtolds/sheepda", true, function(data_, next_, err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.data = ptrType.nil;
			this.next = ptrType$9.nil;
			this.err = $ifaceNil;
			return;
		}
		this.data = data_;
		this.next = next_;
		this.err = err_;
	});
	ptrType = $ptrType(bufio.Reader);
	sliceType = $sliceType($emptyInterface);
	ptrType$1 = $ptrType(byteStream);
	sliceType$1 = $sliceType($Uint8);
	ptrType$2 = $ptrType(LambdaExpr);
	ptrType$3 = $ptrType(Scope);
	ptrType$4 = $ptrType(Closure);
	ptrType$5 = $ptrType(ProgramExpr);
	ptrType$6 = $ptrType(VariableExpr);
	ptrType$7 = $ptrType(ApplicationExpr);
	ptrType$8 = $ptrType(Builtin);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	sliceType$2 = $sliceType(assignment);
	ptrType$9 = $ptrType($Int32);
	mapType = $mapType($Int32, $Bool);
	funcType = $funcType([Value], [Value, $Bool, $error], false);
	mapType$1 = $mapType(ptrType$4, Value);
	funcType$1 = $funcType([Value, $Bool, $error], [Value, $Bool, $error], false);
	ptrType$10 = $ptrType(Stream);
	byteStream.ptr.prototype.readByte = function() {
		var $ptr, _r, _tuple, b, c, err, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; b = $f.b; c = $f.c; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = this;
		if (!($interfaceIsEqual(c.err, $ifaceNil))) {
			$s = -1; return [0, c.err];
			return [0, c.err];
		}
		if (c.in$0 === ptrType.nil) {
			c.err = io.EOF;
			$s = -1; return [0, io.EOF];
			return [0, io.EOF];
		}
		_r = c.in$0.ReadByte(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		b = _tuple[0];
		err = _tuple[1];
		c.err = err;
		$s = -1; return [b, err];
		return [b, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: byteStream.ptr.prototype.readByte }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.b = b; $f.c = c; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
	};
	byteStream.prototype.readByte = function() { return this.$val.readByte(); };
	byteVal.prototype.String = function() {
		var $ptr, _r, b, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this.$val;
		_r = fmt.Sprintf("byte(%x)", new sliceType([new $String($encodeRune(b))])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: byteVal.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.$s = $s; $f.$r = $r; return $f;
	};
	$ptrType(byteVal).prototype.String = function() { return new byteVal(this.$get()).String(); };
	Builtin.ptr.prototype.String = function() {
		var $ptr, _r, b, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; b = $f.b; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		b = this;
		_r = fmt.Sprintf("builtin(%s)", new sliceType([new $String(b.Name)])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Builtin.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f.b = b; $f.$s = $s; $f.$r = $r; return $f;
	};
	Builtin.prototype.String = function() { return this.$val.String(); };
	nextByte = function(v) {
		var $ptr, _r, _tuple, ok, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(v, byteVal, true);
		t = _tuple[0];
		ok = _tuple[1];
		if (ok) {
			$s = -1; return [new byteVal((t + 1 << 24 >>> 24)), true, $ifaceNil];
			return [new byteVal((t + 1 << 24 >>> 24)), true, $ifaceNil];
		}
		_r = fmt.Errorf("type %T is not a byte", new sliceType([v])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return [$ifaceNil, false, _r];
		return [$ifaceNil, false, _r];
		/* */ } return; } if ($f === undefined) { $f = { $blk: nextByte }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	printByte = function(out, v) {
		var $ptr, _r, _r$1, _tuple, _tuple$1, err, ok, out, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; ok = $f.ok; out = $f.out; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = $assertType(v, byteVal, true);
		t = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			/* */ if (!($interfaceIsEqual(out, $ifaceNil))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!($interfaceIsEqual(out, $ifaceNil))) { */ case 3:
				_r = fmt.Fprint(out, new sliceType([new $String($encodeRune(t))])); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple$1 = _r;
				err = _tuple$1[1];
				$s = -1; return [v, false, err];
				return [v, false, err];
			/* } */ case 4:
			$s = -1; return [v, true, $ifaceNil];
			return [v, true, $ifaceNil];
		/* } */ case 2:
		_r$1 = fmt.Errorf("type %T is not a byte", new sliceType([v])); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return [$ifaceNil, false, _r$1];
		return [$ifaceNil, false, _r$1];
		/* */ } return; } if ($f === undefined) { $f = { $blk: printByte }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.ok = ok; $f.out = out; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	readByte = function(stream, v) {
		var $ptr, _r, _tuple, b, err, stream, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; b = $f.b; err = $f.err; stream = $f.stream; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (stream === ptrType$1.nil) {
			$s = -1; return [eofValue, true, $ifaceNil];
			return [eofValue, true, $ifaceNil];
		}
		_r = stream.readByte(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		b = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			if ($interfaceIsEqual(err, io.EOF)) {
				$s = -1; return [eofValue, true, $ifaceNil];
				return [eofValue, true, $ifaceNil];
			}
			$s = -1; return [$ifaceNil, false, err];
			return [$ifaceNil, false, err];
		}
		$s = -1; return [ChurchPair(ChurchBool(true), ChurchNumeral((b >>> 0))), false, $ifaceNil];
		return [ChurchPair(ChurchBool(true), ChurchNumeral((b >>> 0))), false, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: readByte }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.b = b; $f.err = err; $f.stream = stream; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	NewScopeWithBuiltins = function(out, in$1) {
		var $ptr, _r, _r$1, _tuple, _tuple$1, err, in$1, instream, out, printExpr, printVal, readExpr, readVal, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; in$1 = $f.in$1; instream = $f.instream; out = $f.out; printExpr = $f.printExpr; printVal = $f.printVal; readExpr = $f.readExpr; readVal = $f.readVal; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		instream = [instream];
		out = [out];
		_r = Parse(NewStream(bytes.NewReader(new sliceType$1($stringToBytes("\\n.(\\_.\\v.v (print (n next null)) n)"))))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		printExpr = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$panic(err);
		}
		printVal = NewClosure(NewScope().Set("null", new byteVal(0)).SetBuiltin("print", (function(instream, out) { return function $b(v) {
			var $ptr, _r$1, v, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = printByte(out[0], v); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
		}; })(instream, out)).SetBuiltin("next", nextByte), $assertType(printExpr.Expr, ptrType$2));
		instream[0] = ptrType$1.nil;
		if (!($interfaceIsEqual(in$1, $ifaceNil))) {
			instream[0] = new byteStream.ptr(bufio.NewReader(in$1), $ifaceNil);
		}
		_r$1 = Parse(NewStream(bytes.NewReader(new sliceType$1($stringToBytes("\\x.(read x)"))))); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		readExpr = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$panic(err);
		}
		readVal = NewClosure(NewScope().SetBuiltin("read", (function(instream, out) { return function $b(v) {
			var $ptr, _r$2, v, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$2 = $f._r$2; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$2 = readByte(instream[0], v); /* */ $s = 1; case 1: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2;
			return _r$2;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$2 = _r$2; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
		}; })(instream, out)), $assertType(readExpr.Expr, ptrType$2));
		$s = -1; return NewScope().Set("PRINT_BYTE", printVal).Set("READ_BYTE", readVal);
		return NewScope().Set("PRINT_BYTE", printVal).Set("READ_BYTE", readVal);
		/* */ } return; } if ($f === undefined) { $f = { $blk: NewScopeWithBuiltins }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.in$1 = in$1; $f.instream = instream; $f.out = out; $f.printExpr = printExpr; $f.printVal = printVal; $f.readExpr = readExpr; $f.readVal = readVal; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.NewScopeWithBuiltins = NewScopeWithBuiltins;
	Scope.ptr.prototype.SetBuiltin = function(name, fn) {
		var $ptr, fn, name, s;
		s = this;
		return s.Set(name, new Builtin.ptr(name, fn));
	};
	Scope.prototype.SetBuiltin = function(name, fn) { return this.$val.SetBuiltin(name, fn); };
	ChurchNumeral = function(val) {
		var $ptr, base, i, val;
		base = new VariableExpr.ptr("x");
		i = 0;
		while (true) {
			if (!(i < val)) { break; }
			base = new ApplicationExpr.ptr(new VariableExpr.ptr("f"), base);
			i = i + (1) >>> 0;
		}
		return NewClosure(NewScope(), new LambdaExpr.ptr("f", new LambdaExpr.ptr("x", base)));
	};
	$pkg.ChurchNumeral = ChurchNumeral;
	ChurchPair = function(first, second) {
		var $ptr, first, second;
		return NewClosure(NewScope().Set("first", first).Set("second", second), new LambdaExpr.ptr("p", new ApplicationExpr.ptr(new ApplicationExpr.ptr(new VariableExpr.ptr("p"), new VariableExpr.ptr("first")), new VariableExpr.ptr("second"))));
	};
	$pkg.ChurchPair = ChurchPair;
	ChurchBool = function(val) {
		var $ptr, val;
		if (val) {
			return churchTrue;
		}
		return churchFalse;
	};
	$pkg.ChurchBool = ChurchBool;
	NewScope = function() {
		var $ptr;
		return ptrType$3.nil;
	};
	$pkg.NewScope = NewScope;
	Scope.ptr.prototype.Get = function(name) {
		var $ptr, name, s;
		s = this;
		if (s === ptrType$3.nil) {
			return $ifaceNil;
		}
		if (s.Name === name) {
			return s.Value;
		}
		return s.Parent.Get(name);
	};
	Scope.prototype.Get = function(name) { return this.$val.Get(name); };
	Scope.ptr.prototype.Set = function(name, value) {
		var $ptr, name, s, value;
		s = this;
		return new Scope.ptr(name, value, s);
	};
	Scope.prototype.Set = function(name, value) { return this.$val.Set(name, value); };
	NewClosure = function(s, l) {
		var $ptr, l, s;
		return new Closure.ptr(s, l, $makeMap(ptrType$4.keyFor, []));
	};
	$pkg.NewClosure = NewClosure;
	Closure.ptr.prototype.String = function() {
		var $ptr, _r, c, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = this;
		_r = c.Lambda.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Closure.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.$s = $s; $f.$r = $r; return $f;
	};
	Closure.prototype.String = function() { return this.$val.String(); };
	resultMaps.prototype.apply = function(v, c, e) {
		var $ptr, _r, _tuple, c, e, i, r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; c = $f.c; e = $f.e; i = $f.i; r = $f.r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		i = r.$length - 1 >> 0;
		/* while (true) { */ case 1:
			/* if (!(i >= 0)) { break; } */ if(!(i >= 0)) { $s = 2; continue; }
			_r = ((i < 0 || i >= r.$length) ? $throwRuntimeError("index out of range") : r.$array[r.$offset + i])(v, c, e); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			v = _tuple[0];
			c = _tuple[1];
			e = _tuple[2];
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [v, c, e];
		return [v, c, e];
		/* */ } return; } if ($f === undefined) { $f = { $blk: resultMaps.prototype.apply }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.c = c; $f.e = e; $f.i = i; $f.r = r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	$ptrType(resultMaps).prototype.apply = function(v, c, e) { return this.$get().apply(v, c, e); };
	eval$1 = function(s, expr) {
		var $ptr, _arg, _arg$1, _arg$2, _arg$3, _arg$4, _arg$5, _entry, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _tuple, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, arg, argCacheable, c, c$1, c$2, ca, cacheable, cacheable$1, err, err$1, err$2, expr, fn, fnCacheable, mapper, ok, ok$1, s, subCacheable, t, t$1, t$2, t$3, t$4, v, v$1, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _arg$4 = $f._arg$4; _arg$5 = $f._arg$5; _entry = $f._entry; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; arg = $f.arg; argCacheable = $f.argCacheable; c = $f.c; c$1 = $f.c$1; c$2 = $f.c$2; ca = $f.ca; cacheable = $f.cacheable; cacheable$1 = $f.cacheable$1; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; expr = $f.expr; fn = $f.fn; fnCacheable = $f.fnCacheable; mapper = $f.mapper; ok = $f.ok; ok$1 = $f.ok$1; s = $f.s; subCacheable = $f.subCacheable; t = $f.t; t$1 = $f.t$1; t$2 = $f.t$2; t$3 = $f.t$3; t$4 = $f.t$4; v = $f.v; v$1 = $f.v$1; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = $ifaceNil;
		cacheable = false;
		err = $ifaceNil;
		mapper = resultMaps.nil;
		/* while (true) { */ case 1:
			c = [c];
			ca = [ca];
			subCacheable = [subCacheable];
			_ref = expr;
			/* */ if ($assertType(_ref, ptrType$5, true)[1]) { $s = 3; continue; }
			/* */ if ($assertType(_ref, ptrType$6, true)[1]) { $s = 4; continue; }
			/* */ if ($assertType(_ref, ptrType$7, true)[1]) { $s = 5; continue; }
			/* */ if ($assertType(_ref, ptrType$2, true)[1]) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if ($assertType(_ref, ptrType$5, true)[1]) { */ case 3:
				t = _ref.$val;
				expr = t.Expr;
				/* continue trampoline; */ $s = 1; continue s;
				$s = 8; continue;
			/* } else if ($assertType(_ref, ptrType$6, true)[1]) { */ case 4:
				t$1 = _ref.$val;
				val$1 = s.Get(t$1.Name);
				/* */ if ($interfaceIsEqual(val$1, $ifaceNil)) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if ($interfaceIsEqual(val$1, $ifaceNil)) { */ case 9:
					_arg = $ifaceNil;
					_r = fmt.Errorf("invalid variable lookup: %s", new sliceType([new $String(t$1.Name)])); /* */ $s = 11; case 11: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_arg$1 = _r;
					_r$1 = mapper.apply(_arg, false, _arg$1); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple = _r$1;
					val = _tuple[0];
					cacheable = _tuple[1];
					err = _tuple[2];
					$s = -1; return [val, cacheable, err];
					return [val, cacheable, err];
				/* } */ case 10:
				_r$2 = mapper.apply(val$1, true, $ifaceNil); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				val = _tuple$1[0];
				cacheable = _tuple$1[1];
				err = _tuple$1[2];
				$s = -1; return [val, cacheable, err];
				return [val, cacheable, err];
			/* } else if ($assertType(_ref, ptrType$7, true)[1]) { */ case 5:
				t$2 = _ref.$val;
				_r$3 = eval$1(s, t$2.Func); /* */ $s = 14; case 14: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				_tuple$2 = _r$3;
				fn = _tuple$2[0];
				fnCacheable = _tuple$2[1];
				err$1 = _tuple$2[2];
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 15:
					_r$4 = mapper.apply($ifaceNil, false, err$1); /* */ $s = 17; case 17: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					_tuple$3 = _r$4;
					val = _tuple$3[0];
					cacheable = _tuple$3[1];
					err = _tuple$3[2];
					$s = -1; return [val, cacheable, err];
					return [val, cacheable, err];
				/* } */ case 16:
				_r$5 = eval$1(s, t$2.Arg); /* */ $s = 18; case 18: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				_tuple$4 = _r$5;
				arg = _tuple$4[0];
				argCacheable = _tuple$4[1];
				err$1 = _tuple$4[2];
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 19; continue; }
				/* */ $s = 20; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 19:
					_r$6 = mapper.apply($ifaceNil, false, err$1); /* */ $s = 21; case 21: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_tuple$5 = _r$6;
					val = _tuple$5[0];
					cacheable = _tuple$5[1];
					err = _tuple$5[2];
					$s = -1; return [val, cacheable, err];
					return [val, cacheable, err];
				/* } */ case 20:
				subCacheable[0] = fnCacheable && argCacheable;
				_ref$1 = fn;
				/* */ if ($assertType(_ref$1, ptrType$4, true)[1]) { $s = 22; continue; }
				/* */ if ($assertType(_ref$1, ptrType$8, true)[1]) { $s = 23; continue; }
				/* */ $s = 24; continue;
				/* if ($assertType(_ref$1, ptrType$4, true)[1]) { */ case 22:
					c[0] = _ref$1.$val;
					s = c[0].Scope.Set(c[0].Lambda.Arg, arg);
					expr = c[0].Lambda.Body;
					_tuple$6 = $assertType(arg, ptrType$4, true);
					ca[0] = _tuple$6[0];
					ok = _tuple$6[1];
					/* */ if (!ok) { $s = 26; continue; }
					/* */ $s = 27; continue;
					/* if (!ok) { */ case 26:
						_r$7 = eval$1(s, expr); /* */ $s = 28; case 28: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
						_tuple$7 = _r$7;
						v = _tuple$7[0];
						cacheable$1 = _tuple$7[1];
						err$2 = _tuple$7[2];
						_r$8 = mapper.apply(v, cacheable$1 && subCacheable[0], err$2); /* */ $s = 29; case 29: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
						_tuple$8 = _r$8;
						val = _tuple$8[0];
						cacheable = _tuple$8[1];
						err = _tuple$8[2];
						$s = -1; return [val, cacheable, err];
						return [val, cacheable, err];
					/* } */ case 27:
					_tuple$9 = (_entry = c[0].memoize[ptrType$4.keyFor(ca[0])], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
					v$1 = _tuple$9[0];
					ok$1 = _tuple$9[1];
					/* */ if (ok$1) { $s = 30; continue; }
					/* */ $s = 31; continue;
					/* if (ok$1) { */ case 30:
						_r$9 = mapper.apply(v$1, subCacheable[0], $ifaceNil); /* */ $s = 32; case 32: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
						_tuple$10 = _r$9;
						val = _tuple$10[0];
						cacheable = _tuple$10[1];
						err = _tuple$10[2];
						$s = -1; return [val, cacheable, err];
						return [val, cacheable, err];
					/* } */ case 31:
					mapper = $append(mapper, (function(c, ca, subCacheable) { return function(v$2, cacheable$2, err$3) {
						var $ptr, _key, cacheable$2, err$3, v$2;
						if (!($interfaceIsEqual(err$3, $ifaceNil))) {
							return [$ifaceNil, false, err$3];
						}
						if (cacheable$2) {
							_key = ca[0]; (c[0].memoize || $throwRuntimeError("assignment to entry in nil map"))[ptrType$4.keyFor(_key)] = { k: _key, v: v$2 };
						}
						return [v$2, cacheable$2 && subCacheable[0], $ifaceNil];
					}; })(c, ca, subCacheable));
					/* continue trampoline; */ $s = 1; continue s;
					$s = 25; continue;
				/* } else if ($assertType(_ref$1, ptrType$8, true)[1]) { */ case 23:
					c$1 = _ref$1.$val;
					_r$10 = c$1.Transform(arg); /* */ $s = 33; case 33: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
					_tuple$12 = _r$10;
					_r$11 = mapper.apply(_tuple$12[0], _tuple$12[1], _tuple$12[2]); /* */ $s = 34; case 34: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
					_tuple$11 = _r$11;
					val = _tuple$11[0];
					cacheable = _tuple$11[1];
					err = _tuple$11[2];
					$s = -1; return [val, cacheable, err];
					return [val, cacheable, err];
				/* } else { */ case 24:
					c$2 = _ref$1;
					_arg$2 = $ifaceNil;
					_r$12 = fmt.Errorf("not callable", new sliceType([])); /* */ $s = 35; case 35: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
					_arg$3 = _r$12;
					_r$13 = mapper.apply(_arg$2, false, _arg$3); /* */ $s = 36; case 36: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
					_tuple$13 = _r$13;
					val = _tuple$13[0];
					cacheable = _tuple$13[1];
					err = _tuple$13[2];
					$s = -1; return [val, cacheable, err];
					return [val, cacheable, err];
				/* } */ case 25:
				$s = 8; continue;
			/* } else if ($assertType(_ref, ptrType$2, true)[1]) { */ case 6:
				t$3 = _ref.$val;
				_r$14 = mapper.apply(NewClosure(s, t$3), true, $ifaceNil); /* */ $s = 37; case 37: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				_tuple$14 = _r$14;
				val = _tuple$14[0];
				cacheable = _tuple$14[1];
				err = _tuple$14[2];
				$s = -1; return [val, cacheable, err];
				return [val, cacheable, err];
			/* } else { */ case 7:
				t$4 = _ref;
				_arg$4 = $ifaceNil;
				_r$15 = fmt.Errorf("unknown expression: %T", new sliceType([expr])); /* */ $s = 38; case 38: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
				_arg$5 = _r$15;
				_r$16 = mapper.apply(_arg$4, false, _arg$5); /* */ $s = 39; case 39: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
				_tuple$15 = _r$16;
				val = _tuple$15[0];
				cacheable = _tuple$15[1];
				err = _tuple$15[2];
				$s = -1; return [val, cacheable, err];
				return [val, cacheable, err];
			/* } */ case 8:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [val, cacheable, err];
		return [val, cacheable, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: eval$1 }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._arg$4 = _arg$4; $f._arg$5 = _arg$5; $f._entry = _entry; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.arg = arg; $f.argCacheable = argCacheable; $f.c = c; $f.c$1 = c$1; $f.c$2 = c$2; $f.ca = ca; $f.cacheable = cacheable; $f.cacheable$1 = cacheable$1; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.expr = expr; $f.fn = fn; $f.fnCacheable = fnCacheable; $f.mapper = mapper; $f.ok = ok; $f.ok$1 = ok$1; $f.s = s; $f.subCacheable = subCacheable; $f.t = t; $f.t$1 = t$1; $f.t$2 = t$2; $f.t$3 = t$3; $f.t$4 = t$4; $f.v = v; $f.v$1 = v$1; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Eval = function(s, expr) {
		var $ptr, _r, _tmp, _tmp$1, _tuple, err, expr, s, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; err = $f.err; expr = $f.expr; s = $f.s; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = $ifaceNil;
		err = $ifaceNil;
		_r = eval$1(s, expr); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		val = _tuple[0];
		err = _tuple[2];
		_tmp = val;
		_tmp$1 = err;
		val = _tmp;
		err = _tmp$1;
		$s = -1; return [val, err];
		return [val, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Eval }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.err = err; $f.expr = expr; $f.s = s; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Eval = Eval;
	IsVariableRune = function(ch) {
		var $ptr, _entry, ch;
		return !unicode.IsSpace(ch) && !((ch === 40)) && !((ch === 41)) && !((ch === 46)) && !((ch === 61)) && !(_entry = $pkg.Lambdas[$Int32.keyFor(ch)], _entry !== undefined ? _entry.v : false);
	};
	$pkg.IsVariableRune = IsVariableRune;
	ParseVariable = function(s) {
		var $ptr, _r, _r$1, _r$2, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, ch, err, err$1, name, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; ch = $f.ch; err = $f.err; err$1 = $f.err$1; name = $f.name; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		err = $ifaceNil;
		/* while (true) { */ case 1:
			_r = s.Peek(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			ch = _tuple[0];
			err$1 = _tuple[1];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				if ($interfaceIsEqual(err$1, io.EOF) && !(name === "")) {
					/* break; */ $s = 2; continue;
				}
				_tmp = "";
				_tmp$1 = err$1;
				name = _tmp;
				err = _tmp$1;
				$s = -1; return [name, err];
				return [name, err];
			}
			if (!IsVariableRune(ch)) {
				/* break; */ $s = 2; continue;
			}
			name = name + ($encodeRune(ch));
			s.Next();
		/* } */ $s = 1; continue; case 2:
		/* */ if (name === "") { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (name === "") { */ case 4:
			_tmp$2 = "";
			_r$1 = fmt.Errorf("variable expected, not found", new sliceType([])); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tmp$3 = _r$1;
			name = _tmp$2;
			err = _tmp$3;
			$s = -1; return [name, err];
			return [name, err];
		/* } */ case 5:
		_tmp$4 = name;
		_r$2 = s.SwallowWhitespace(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tmp$5 = _r$2;
		name = _tmp$4;
		err = _tmp$5;
		$s = -1; return [name, err];
		return [name, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ParseVariable }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.ch = ch; $f.err = err; $f.err$1 = err$1; $f.name = name; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ParseVariable = ParseVariable;
	LambdaExpr.ptr.prototype.String = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = fmt.Sprintf("\xCE\xBB%s.%s", new sliceType([new $String(e.Arg), e.Body])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: LambdaExpr.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	LambdaExpr.prototype.String = function() { return this.$val.String(); };
	ParseLambda = function(s) {
		var $ptr, _r, _r$1, _r$2, _r$3, _tuple, _tuple$1, arg, body, err, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; arg = $f.arg; body = $f.body; err = $f.err; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = s.AssertMatch($pkg.Lambdas); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [ptrType$2.nil, err];
			return [ptrType$2.nil, err];
		}
		_r$1 = ParseVariable(s); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		arg = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [ptrType$2.nil, err];
			return [ptrType$2.nil, err];
		}
		_r$2 = s.AssertMatch($makeMap($Int32.keyFor, [{ k: 46, v: true }])); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		err = _r$2;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [ptrType$2.nil, err];
			return [ptrType$2.nil, err];
		}
		_r$3 = ParseExpr(s); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_tuple$1 = _r$3;
		body = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [ptrType$2.nil, err];
			return [ptrType$2.nil, err];
		}
		$s = -1; return [new LambdaExpr.ptr(arg, body), $ifaceNil];
		return [new LambdaExpr.ptr(arg, body), $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ParseLambda }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.arg = arg; $f.body = body; $f.err = err; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ParseLambda = ParseLambda;
	ApplicationExpr.ptr.prototype.String = function() {
		var $ptr, _r, _r$1, _tuple, e, l, ok, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; e = $f.e; l = $f.l; ok = $f.ok; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_tuple = $assertType(e.Func, ptrType$2, true);
		l = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			_r = fmt.Sprintf("((%s) %s)", new sliceType([l, e.Arg])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
			return _r;
		/* } */ case 2:
		_r$1 = fmt.Sprintf("(%s %s)", new sliceType([e.Func, e.Arg])); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ApplicationExpr.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.e = e; $f.l = l; $f.ok = ok; $f.$s = $s; $f.$r = $r; return $f;
	};
	ApplicationExpr.prototype.String = function() { return this.$val.String(); };
	ParseSubexpression = function(s) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _tuple, _tuple$1, _tuple$2, err, err$1, fn, next, r, result, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; err = $f.err; err$1 = $f.err$1; fn = $f.fn; next = $f.next; r = $f.r; result = $f.result; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = s.AssertMatch($makeMap($Int32.keyFor, [{ k: 40, v: true }])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [$ifaceNil, err];
			return [$ifaceNil, err];
		}
		_r$1 = ParseExpr(s); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		fn = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [$ifaceNil, err];
			return [$ifaceNil, err];
		}
		result = fn;
		/* while (true) { */ case 3:
			_r$2 = s.Peek(); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tuple$1 = _r$2;
			r = _tuple$1[0];
			err$1 = _tuple$1[1];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$s = -1; return [$ifaceNil, err$1];
				return [$ifaceNil, err$1];
			}
			/* */ if (r === 41) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (r === 41) { */ case 6:
				s.Next();
				_r$3 = s.SwallowWhitespace(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				$s = -1; return [result, _r$3];
				return [result, _r$3];
			/* } */ case 7:
			_r$4 = ParseExpr(s); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_tuple$2 = _r$4;
			next = _tuple$2[0];
			err$1 = _tuple$2[1];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$s = -1; return [$ifaceNil, err$1];
				return [$ifaceNil, err$1];
			}
			result = new ApplicationExpr.ptr(result, next);
		/* } */ $s = 3; continue; case 4:
		$s = -1; return [$ifaceNil, $ifaceNil];
		return [$ifaceNil, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ParseSubexpression }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.err = err; $f.err$1 = err$1; $f.fn = fn; $f.next = next; $f.r = r; $f.result = result; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ParseSubexpression = ParseSubexpression;
	VariableExpr.ptr.prototype.String = function() {
		var $ptr, e;
		e = this;
		return e.Name;
	};
	VariableExpr.prototype.String = function() { return this.$val.String(); };
	ParseExpr = function(s) {
		var $ptr, _entry, _r, _r$1, _r$2, _r$3, _r$4, _returncast, _tuple, _tuple$1, err, err$1, name, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _returncast = $f._returncast; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; err$1 = $f.err$1; name = $f.name; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = s.Peek(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [$ifaceNil, err];
			return [$ifaceNil, err];
		}
		/* */ if ((_entry = $pkg.Lambdas[$Int32.keyFor(r)], _entry !== undefined ? _entry.v : false)) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if ((_entry = $pkg.Lambdas[$Int32.keyFor(r)], _entry !== undefined ? _entry.v : false)) { */ case 2:
			_r$1 = ParseLambda(s); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_returncast = _r$1;
			$s = -1; return [_returncast[0], _returncast[1]];
			return [_returncast[0], _returncast[1]];
		/* } */ case 3:
		/* */ if (r === 40) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (r === 40) { */ case 5:
			_r$2 = ParseSubexpression(s); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2;
			return _r$2;
		/* } */ case 6:
		/* */ if (IsVariableRune(r)) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (IsVariableRune(r)) { */ case 8:
			_r$3 = ParseVariable(s); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$1 = _r$3;
			name = _tuple$1[0];
			err$1 = _tuple$1[1];
			$s = -1; return [new VariableExpr.ptr(name), err$1];
			return [new VariableExpr.ptr(name), err$1];
		/* } */ case 9:
		_r$4 = fmt.Errorf("expression not found", new sliceType([])); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return [$ifaceNil, _r$4];
		return [$ifaceNil, _r$4];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ParseExpr }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._returncast = _returncast; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.err$1 = err$1; $f.name = name; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ParseExpr = ParseExpr;
	ProgramExpr.ptr.prototype.String = function() {
		var $ptr, _r, _r$1, _r$2, _tuple, _tuple$1, applications, e, expr, fn, ok, ok$1, out, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; applications = $f.applications; e = $f.e; expr = $f.expr; fn = $f.fn; ok = $f.ok; ok$1 = $f.ok$1; out = $f.out; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		out = [out];
		e = this;
		out[0] = new bytes.Buffer.ptr(sliceType$1.nil, 0, arrayType.zero(), arrayType$1.zero(), 0);
		expr = e.Expr;
		applications = false;
		/* while (true) { */ case 1:
			_tuple = $assertType(expr, ptrType$7, true);
			t = _tuple[0];
			ok = _tuple[1];
			/* */ if (ok) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (ok) { */ case 3:
				_tuple$1 = $assertType(t.Func, ptrType$2, true);
				fn = _tuple$1[0];
				ok$1 = _tuple$1[1];
				/* */ if (ok$1) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (ok$1) { */ case 5:
					_r = fmt.Fprintf(out[0], "%s = %s\n", new sliceType([new $String(fn.Arg), t.Arg])); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_r;
					expr = fn.Body;
					applications = true;
					/* continue; */ $s = 1; continue;
				/* } */ case 6:
			/* } */ case 4:
			/* */ if (applications) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (applications) { */ case 8:
				_r$1 = fmt.Fprintln(out[0], new sliceType([])); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$1;
			/* } */ case 9:
			_r$2 = fmt.Fprint(out[0], new sliceType([expr])); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_r$2;
			$s = -1; return out[0].String();
			return out[0].String();
		/* } */ $s = 1; continue; case 2:
		$s = -1; return "";
		return "";
		/* */ } return; } if ($f === undefined) { $f = { $blk: ProgramExpr.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.applications = applications; $f.e = e; $f.expr = expr; $f.fn = fn; $f.ok = ok; $f.ok$1 = ok$1; $f.out = out; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	ProgramExpr.prototype.String = function() { return this.$val.String(); };
	Parse = function(s) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _tuple, _tuple$1, _tuple$2, assignments, err, err$1, expr, i, ok, rhs, s, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; assignments = $f.assignments; err = $f.err; err$1 = $f.err$1; expr = $f.expr; i = $f.i; ok = $f.ok; rhs = $f.rhs; s = $f.s; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = s.SwallowWhitespace(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [ptrType$5.nil, err];
			return [ptrType$5.nil, err];
		}
		assignments = sliceType$2.nil;
		/* while (true) { */ case 2:
			_r$1 = ParseExpr(s); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple = _r$1;
			expr = _tuple[0];
			err$1 = _tuple[1];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$s = -1; return [ptrType$5.nil, err$1];
				return [ptrType$5.nil, err$1];
			}
			if (s.EOF()) {
				i = assignments.$length - 1 >> 0;
				while (true) {
					if (!(i >= 0)) { break; }
					expr = new ApplicationExpr.ptr(new LambdaExpr.ptr(((i < 0 || i >= assignments.$length) ? $throwRuntimeError("index out of range") : assignments.$array[assignments.$offset + i]).LHS, expr), ((i < 0 || i >= assignments.$length) ? $throwRuntimeError("index out of range") : assignments.$array[assignments.$offset + i]).RHS);
					i = i - (1) >> 0;
				}
				$s = -1; return [new ProgramExpr.ptr(expr), $ifaceNil];
				return [new ProgramExpr.ptr(expr), $ifaceNil];
			}
			_tuple$1 = $assertType(expr, ptrType$6, true);
			t = _tuple$1[0];
			ok = _tuple$1[1];
			/* */ if (!ok) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!ok) { */ case 5:
				_r$2 = fmt.Errorf("unparsed code remaining", new sliceType([])); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$s = -1; return [ptrType$5.nil, _r$2];
				return [ptrType$5.nil, _r$2];
			/* } */ case 6:
			_r$3 = s.AssertMatch($makeMap($Int32.keyFor, [{ k: 61, v: true }])); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			err$1 = _r$3;
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$s = -1; return [ptrType$5.nil, err$1];
				return [ptrType$5.nil, err$1];
			}
			_r$4 = ParseExpr(s); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			_tuple$2 = _r$4;
			rhs = _tuple$2[0];
			err$1 = _tuple$2[1];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				$s = -1; return [ptrType$5.nil, err$1];
				return [ptrType$5.nil, err$1];
			}
			assignments = $append(assignments, new assignment.ptr(t.Name, rhs));
		/* } */ $s = 2; continue; case 3:
		$s = -1; return [ptrType$5.nil, $ifaceNil];
		return [ptrType$5.nil, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.assignments = assignments; $f.err = err; $f.err$1 = err$1; $f.expr = expr; $f.i = i; $f.ok = ok; $f.rhs = rhs; $f.s = s; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	NewStream = function(in$1) {
		var $ptr, in$1;
		return new Stream.ptr(bufio.NewReader(in$1), ptrType$9.nil, $ifaceNil);
	};
	$pkg.NewStream = NewStream;
	Stream.ptr.prototype.EOF = function() {
		var $ptr, s;
		s = this;
		return $interfaceIsEqual(s.err, io.EOF);
	};
	Stream.prototype.EOF = function() { return this.$val.EOF(); };
	Stream.ptr.prototype.readRune = function() {
		var $ptr, _r, _r$1, _tuple, err, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.data.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [0, err];
			return [0, err];
		}
		/* */ if (r === 65533) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (r === 65533) { */ case 2:
			_r$1 = fmt.Errorf("invalid unicode", new sliceType([])); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return [0, _r$1];
			return [0, _r$1];
		/* } */ case 3:
		$s = -1; return [r, $ifaceNil];
		return [r, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.readRune }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.readRune = function() { return this.$val.readRune(); };
	Stream.ptr.prototype.fillNext = function() {
		var $ptr, _r, _r$1, _r$2, _tuple, _tuple$1, err, err$1, r, r$1, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; err$1 = $f.err$1; r = $f.r; r$1 = $f.r$1; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = [r];
		s = this;
		if (!(s.next === ptrType$9.nil)) {
			$s = -1; return $ifaceNil;
			return $ifaceNil;
		}
		if (!($interfaceIsEqual(s.err, $ifaceNil))) {
			$s = -1; return s.err;
			return s.err;
		}
		_r = s.readRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r[0] = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			s.err = err;
			$s = -1; return err;
			return err;
		}
		/* */ if (r[0] === 35) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (r[0] === 35) { */ case 2:
			/* while (true) { */ case 4:
				_r$1 = s.readRune(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple$1 = _r$1;
				r$1 = _tuple$1[0];
				err$1 = _tuple$1[1];
				if (!($interfaceIsEqual(err$1, $ifaceNil))) {
					s.err = err$1;
					$s = -1; return err$1;
					return err$1;
				}
				if (r$1 === 10) {
					/* break; */ $s = 5; continue;
				}
			/* } */ $s = 4; continue; case 5:
			_r$2 = s.fillNext(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2;
			return _r$2;
		/* } */ case 3:
		s.next = (r.$ptr || (r.$ptr = new ptrType$9(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, r)));
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.fillNext }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.err$1 = err$1; $f.r = r; $f.r$1 = r$1; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.fillNext = function() { return this.$val.fillNext(); };
	Stream.ptr.prototype.Peek = function() {
		var $ptr, _r, err, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.fillNext(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return [0, err];
			return [0, err];
		}
		$s = -1; return [s.next.$get(), $ifaceNil];
		return [s.next.$get(), $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.Peek }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.Peek = function() { return this.$val.Peek(); };
	Stream.ptr.prototype.Next = function() {
		var $ptr, s;
		s = this;
		s.next = ptrType$9.nil;
	};
	Stream.prototype.Next = function() { return this.$val.Next(); };
	Stream.ptr.prototype.Get = function() {
		var $ptr, _r, _tmp, _tmp$1, _tuple, err, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		err = $ifaceNil;
		s = this;
		_r = s.Peek(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[1];
		s.Next();
		_tmp = r;
		_tmp$1 = err;
		r = _tmp;
		err = _tmp$1;
		$s = -1; return [r, err];
		return [r, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.Get = function() { return this.$val.Get(); };
	Stream.ptr.prototype.SwallowWhitespace = function() {
		var $ptr, _r, _tuple, err, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* while (true) { */ case 1:
			_r = s.Peek(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			r = _tuple[0];
			err = _tuple[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				if ($interfaceIsEqual(err, io.EOF)) {
					$s = -1; return $ifaceNil;
					return $ifaceNil;
				}
				$s = -1; return err;
				return err;
			}
			if (!unicode.IsSpace(r)) {
				$s = -1; return $ifaceNil;
				return $ifaceNil;
			}
			s.Next();
		/* } */ $s = 1; continue; case 2:
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.SwallowWhitespace }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.SwallowWhitespace = function() { return this.$val.SwallowWhitespace(); };
	Stream.ptr.prototype.AssertMatch = function(options) {
		var $ptr, _entry, _r, _r$1, _r$2, _tuple, err, options, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; err = $f.err; options = $f.options; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.Get(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$s = -1; return err;
			return err;
		}
		/* */ if (!(_entry = options[$Int32.keyFor(r)], _entry !== undefined ? _entry.v : false)) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!(_entry = options[$Int32.keyFor(r)], _entry !== undefined ? _entry.v : false)) { */ case 2:
			_r$1 = fmt.Errorf("unexpected rune. expected %#v, got %#v", new sliceType([new mapType(options), new $String($encodeRune(r))])); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
		/* } */ case 3:
		_r$2 = s.SwallowWhitespace(); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Stream.ptr.prototype.AssertMatch }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f.err = err; $f.options = options; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Stream.prototype.AssertMatch = function(options) { return this.$val.AssertMatch(options); };
	ptrType$1.methods = [{prop: "readByte", name: "readByte", pkg: "github.com/jtolds/sheepda", typ: $funcType([], [$Uint8, $error], false)}];
	byteVal.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$8.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$3.methods = [{prop: "SetBuiltin", name: "SetBuiltin", pkg: "", typ: $funcType([$String, funcType], [ptrType$3], false)}, {prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, Value], [ptrType$3], false)}];
	ptrType$4.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	resultMaps.methods = [{prop: "apply", name: "apply", pkg: "github.com/jtolds/sheepda", typ: $funcType([Value, $Bool, $error], [Value, $Bool, $error], false)}];
	ptrType$2.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$7.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$6.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$5.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$10.methods = [{prop: "EOF", name: "EOF", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "readRune", name: "readRune", pkg: "github.com/jtolds/sheepda", typ: $funcType([], [$Int32, $error], false)}, {prop: "fillNext", name: "fillNext", pkg: "github.com/jtolds/sheepda", typ: $funcType([], [$error], false)}, {prop: "Peek", name: "Peek", pkg: "", typ: $funcType([], [$Int32, $error], false)}, {prop: "Next", name: "Next", pkg: "", typ: $funcType([], [], false)}, {prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$Int32, $error], false)}, {prop: "SwallowWhitespace", name: "SwallowWhitespace", pkg: "", typ: $funcType([], [$error], false)}, {prop: "AssertMatch", name: "AssertMatch", pkg: "", typ: $funcType([mapType], [$error], false)}];
	byteStream.init("github.com/jtolds/sheepda", [{prop: "in$0", name: "in", exported: false, typ: ptrType, tag: ""}, {prop: "err", name: "err", exported: false, typ: $error, tag: ""}]);
	Builtin.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "Transform", name: "Transform", exported: true, typ: funcType, tag: ""}]);
	Scope.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "Value", name: "Value", exported: true, typ: Value, tag: ""}, {prop: "Parent", name: "Parent", exported: true, typ: ptrType$3, tag: ""}]);
	Value.init([{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}]);
	Closure.init("github.com/jtolds/sheepda", [{prop: "Scope", name: "Scope", exported: true, typ: ptrType$3, tag: ""}, {prop: "Lambda", name: "Lambda", exported: true, typ: ptrType$2, tag: ""}, {prop: "memoize", name: "memoize", exported: false, typ: mapType$1, tag: ""}]);
	resultMaps.init(funcType$1);
	Expr.init([{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}]);
	LambdaExpr.init("", [{prop: "Arg", name: "Arg", exported: true, typ: $String, tag: ""}, {prop: "Body", name: "Body", exported: true, typ: Expr, tag: ""}]);
	ApplicationExpr.init("", [{prop: "Func", name: "Func", exported: true, typ: Expr, tag: ""}, {prop: "Arg", name: "Arg", exported: true, typ: Expr, tag: ""}]);
	VariableExpr.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}]);
	assignment.init("", [{prop: "LHS", name: "LHS", exported: true, typ: $String, tag: ""}, {prop: "RHS", name: "RHS", exported: true, typ: Expr, tag: ""}]);
	ProgramExpr.init("", [{prop: "Expr", name: "", exported: true, typ: Expr, tag: ""}]);
	Stream.init("github.com/jtolds/sheepda", [{prop: "data", name: "data", exported: false, typ: ptrType, tag: ""}, {prop: "next", name: "next", exported: false, typ: ptrType$9, tag: ""}, {prop: "err", name: "err", exported: false, typ: $error, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bufio.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = bytes.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = fmt.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		churchTrue = NewClosure(NewScope(), new LambdaExpr.ptr("t", new LambdaExpr.ptr("f", new VariableExpr.ptr("t"))));
		churchFalse = NewClosure(NewScope(), new LambdaExpr.ptr("t", new LambdaExpr.ptr("f", new VariableExpr.ptr("f"))));
		eofValue = ChurchPair(ChurchBool(false), ChurchNumeral(0));
		$pkg.Lambdas = $makeMap($Int32.keyFor, [{ k: 923, v: true }, { k: 955, v: true }, { k: 7463, v: true }, { k: 11414, v: true }, { k: 11415, v: true }, { k: 120498, v: true }, { k: 120524, v: true }, { k: 120556, v: true }, { k: 120582, v: true }, { k: 120614, v: true }, { k: 120640, v: true }, { k: 120672, v: true }, { k: 120698, v: true }, { k: 120730, v: true }, { k: 120756, v: true }, { k: 92, v: true }]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/jtolds/sheepda/bin/sheepdajs"] = (function() {
	var $pkg = {}, $init, bytes, fmt, js, sheepda, funcType, mapType, sliceType, sliceType$1, arrayType, arrayType$1, main, Eval;
	bytes = $packages["bytes"];
	fmt = $packages["fmt"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sheepda = $packages["github.com/jtolds/sheepda"];
	funcType = $funcType([$String, $String], [$String, $String], false);
	mapType = $mapType($String, $emptyInterface);
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($emptyInterface);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	main = function() {
		var $ptr;
		$global.sheepda = $externalize($makeMap($String.keyFor, [{ k: "eval", v: new funcType(Eval) }]), mapType);
	};
	Eval = function(source, mode) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, err, failure, mode, out, output, prog, source, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; failure = $f.failure; mode = $f.mode; out = $f.out; output = $f.output; prog = $f.prog; source = $f.source; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		out = [out];
		output = "";
		failure = "";
		_r = sheepda.Parse(sheepda.NewStream(bytes.NewReader(new sliceType($stringToBytes(source))))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		prog = _tuple[0];
		err = _tuple[1];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 2:
			_tmp = "";
			_r$1 = err.Error(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tmp$1 = _r$1;
			output = _tmp;
			failure = _tmp$1;
			$s = -1; return [output, failure];
			return [output, failure];
		/* } */ case 3:
		/* */ if (mode === "parse") { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (mode === "parse") { */ case 5:
			_r$2 = fmt.Sprint(new sliceType$1([prog.Expr])); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_tmp$2 = _r$2;
			_tmp$3 = "";
			output = _tmp$2;
			failure = _tmp$3;
			$s = -1; return [output, failure];
			return [output, failure];
		/* } */ case 6:
		out[0] = new bytes.Buffer.ptr(sliceType.nil, 0, arrayType.zero(), arrayType$1.zero(), 0);
		_r$3 = sheepda.NewScopeWithBuiltins(out[0], $ifaceNil); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_r$4 = sheepda.Eval(_r$3, prog); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_tuple$1 = _r$4;
		val = _tuple$1[0];
		err = _tuple$1[1];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 10; continue; }
		/* */ $s = 11; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 10:
			_tmp$4 = "";
			_r$5 = err.Error(); /* */ $s = 12; case 12: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_tmp$5 = _r$5;
			output = _tmp$4;
			failure = _tmp$5;
			$s = -1; return [output, failure];
			return [output, failure];
		/* } */ case 11:
		if (mode === "output") {
			_tmp$6 = out[0].String();
			_tmp$7 = "";
			output = _tmp$6;
			failure = _tmp$7;
			$s = -1; return [output, failure];
			return [output, failure];
		}
		/* */ if (mode === "result") { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (mode === "result") { */ case 13:
			_r$6 = val.String(); /* */ $s = 15; case 15: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
			_tmp$8 = _r$6;
			_tmp$9 = "";
			output = _tmp$8;
			failure = _tmp$9;
			$s = -1; return [output, failure];
			return [output, failure];
		/* } */ case 14:
		_tmp$10 = "";
		_tmp$11 = "undefined mode";
		output = _tmp$10;
		failure = _tmp$11;
		$s = -1; return [output, failure];
		return [output, failure];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Eval }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.failure = failure; $f.mode = mode; $f.out = out; $f.output = output; $f.prog = prog; $f.source = source; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Eval = Eval;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = fmt.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sheepda.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["github.com/jtolds/sheepda/bin/sheepdajs"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=sheepdajs.js.map
