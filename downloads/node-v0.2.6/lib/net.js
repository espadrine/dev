var sys = require("sys");
var fs = require("fs");
var events = require("events");
var dns = require('dns');

var kMinPoolSpace = 128;
var kPoolSize = 40*1024;

var debugLevel = parseInt(process.env.NODE_DEBUG, 16);
function debug () {
  if (debugLevel & 0x2) sys.error.apply(this, arguments);
}
var binding = process.binding('net');

// Note about Buffer interface:
// I'm attempting to do the simplest possible interface to abstracting raw
// memory allocation. This might turn out to be too simple - it seems that
// I always use a buffer.used member to keep track of how much I've filled.
// Perhaps giving the Buffer a file-like interface with a head (which would
// represent buffer.used) that can be seeked around would be easier. I'm not
// yet convinced that every use-case can be fit into that abstraction, so
// waiting to implement it until I get more experience with this.
var Buffer = require('buffer').Buffer;
var FreeList = require('freelist').FreeList;

var IOWatcher   = process.IOWatcher;
var assert      = process.assert;

var socket      = binding.socket;
var bind        = binding.bind;
var connect     = binding.connect;
var listen      = binding.listen;
var accept      = binding.accept;
var close       = binding.close;
var shutdown    = binding.shutdown;
var read        = binding.read;
var write       = binding.write;
var toRead      = binding.toRead;
var setNoDelay  = binding.setNoDelay;
var setKeepAlive= binding.setKeepAlive;
var socketError = binding.socketError;
var getsockname = binding.getsockname;
var errnoException = binding.errnoException;
var sendMsg     = binding.sendMsg;
var recvMsg     = binding.recvMsg;
var EINPROGRESS = binding.EINPROGRESS;
var ENOENT      = binding.ENOENT;
var EMFILE      = binding.EMFILE;
var END_OF_FILE = 42;

// Do we have openssl crypto?
try {
  var SecureContext = process.binding('crypto').SecureContext;
  var SecureStream = process.binding('crypto').SecureStream;
  var have_crypto = true;
} catch (e) {
  var have_crypto = false;
}

// IDLE TIMEOUTS
//
// Because often many sockets will have the same idle timeout we will not
// use one timeout watcher per socket. It is too much overhead.  Instead
// we'll use a single watcher for all sockets with the same timeout value
// and a linked list. This technique is described in the libev manual:
// http://pod.tst.eu/http://cvs.schmorp.de/libev/ev.pod#Be_smart_about_timeouts


var timeout = new (function () {
  // Object containing all lists, timers
  // key = time in milliseconds
  // value = list
  var lists = {};

  // show the most idle socket
  function peek (list) {
    if (list._idlePrev == list) return null;
    return list._idlePrev;
  }


  // remove the most idle socket from the list
  function shift (list) {
    var first = list._idlePrev;
    remove(first);
    return first;
  }


  // remove a socket from its list
  function remove (socket) {
    socket._idleNext._idlePrev = socket._idlePrev;
    socket._idlePrev._idleNext = socket._idleNext;
  }


  // remove a socket from its list and place at the end.
  function append (list, socket) {
    remove(socket);
    socket._idleNext = list._idleNext;
    socket._idleNext._idlePrev = socket;
    socket._idlePrev = list
    list._idleNext = socket;
  }


  function normalize (msecs) {
    if (!msecs || msecs <= 0) return 0;
    // round up to one sec
    if (msecs < 1000) return 1000;
    // round down to nearest second.
    return msecs - (msecs % 1000);
  }

  // the main function - creates lists on demand and the watchers associated
  // with them.
  function insert (socket, msecs) {
    socket._idleStart = new Date();
    socket._idleTimeout = msecs;

    if (!msecs) return;

    var list;

    if (lists[msecs]) {
      list = lists[msecs];
    } else {
      list = new process.Timer();
      list._idleNext = list;
      list._idlePrev = list;

      lists[msecs] = list;

      list.callback = function () {
        debug('timeout callback ' + msecs);
        // TODO - don't stop and start the watcher all the time.
        // just set its repeat
        var now = new Date();
        debug("now: " + now);
        var first;
        while (first = peek(list)) {
          var diff = now - first._idleStart;
          if (diff < msecs) {
            list.again(msecs - diff);
            debug(msecs + ' list wait because diff is '  + diff);
            return;
          } else {
            remove(first);
            assert(first != peek(list));
            first.emit('timeout');
          }
        }
        debug(msecs + ' list empty');
        assert(list._idleNext == list); // list is empty
        list.stop();
      };
    }

    if (list._idleNext == list) {
      // if empty (re)start the timer
      list.again(msecs);
    }

    append(list, socket);
    assert(list._idleNext != list); // list is not empty
  }


  var unenroll = this.unenroll = function (socket) {
    if (socket._idleNext) {
      socket._idleNext._idlePrev = socket._idlePrev;
      socket._idlePrev._idleNext = socket._idleNext;

      var list = lists[socket._idleTimeout];
      // if empty then stop the watcher
      //debug('unenroll');
      if (list && list._idlePrev == list) {
        //debug('unenroll: list empty');
        list.stop();
      }
    }
  };


  // Does not start the time, just sets up the members needed.
  this.enroll = function (socket, msecs) {
    // if this socket was already in a list somewhere
    // then we should unenroll it from that
    if (socket._idleNext) unenroll(socket);

    socket._idleTimeout = msecs;
    socket._idleNext = socket;
    socket._idlePrev = socket;
  };

  // call this whenever the socket is active (not idle)
  // it will reset its timeout.
  this.active = function (socket) {
    var msecs = socket._idleTimeout;
    if (msecs) {
      var list = lists[msecs];
      if (socket._idleNext == socket) {
        insert(socket, msecs);
      } else {
        // inline append
        socket._idleStart = new Date();
        socket._idleNext._idlePrev = socket._idlePrev;
        socket._idlePrev._idleNext = socket._idleNext;
        socket._idleNext = list._idleNext;
        socket._idleNext._idlePrev = socket;
        socket._idlePrev = list
        list._idleNext = socket;
      }
    }
  };
})();

var ioWatchers = new FreeList("iowatcher", 100, function () {
  return new IOWatcher();
});


// Allocated on demand.
var pool = null;
function allocNewPool () {
  pool = new Buffer(kPoolSize);
  pool.used = 0;
}

var securePool = null;
function allocNewSecurePool () {
  securePool = new Buffer(40*1024);
}

var emptyBuffer = null;
function allocEmptyBuffer () {
    emptyBuffer = new Buffer(1);
    emptyBuffer.sent = 0;
    emptyBuffer.length = 0;
}

function _doFlush () {
  var socket = this.socket;
  // Stream becomes writeable on connect() but don't flush if there's
  // nothing actually to write
  if (socket.flush()) {
    if (socket._events && socket._events['drain']) socket.emit("drain");
    if (socket.ondrain) socket.ondrain(); // Optimization
  }
}

function setImplmentationMethods (self) {
  function noData(buf, off, len) {
    return !buf ||
           (off != undefined && off >= buf.length) ||
           (len == 0);
  };

  if (self.type == 'unix') {
    self._writeImpl = function(buf, off, len, fd, flags) {
      // Detect and disallow zero-byte writes wth an attached file
      // descriptor. This is an implementation limitation of sendmsg(2).
      if (fd && noData(buf, off, len)) {
        throw new Error('File descriptors can only be written with data');
      }

      return sendMsg(self.fd, buf, off, len, fd, flags);
    };

    self._readImpl = function(buf, off, len, calledByIOWatcher) {
      var bytesRead = recvMsg(self.fd, buf, off, len);

      // Do not emit this in the same stack, otherwise we risk corrupting our
      // buffer pool which is full of read data, but has not had had its
      // pointers updated just yet.
      //
      // Save off recvMsg.fd in a closure so that, when we emit it later, we're
      // emitting the same value that we see now. Otherwise, we can end up
      // calling emit() after recvMsg() has been called again and end up
      // emitting null (or another FD).
      if (recvMsg.fd !== null) {
        (function () {
          var fd = recvMsg.fd;
          process.nextTick(function() {
            self.emit('fd', fd);
          });
        })();
      }

      return bytesRead;
    };
  } else {
    self._writeImpl = function(buf, off, len, fd, flags) {
      // XXX: TLS support requires that 0-byte writes get processed
      //      by the kernel for some reason. Otherwise, we'd just
      //      fast-path return here.

      // Drop 'fd' and 'flags' as these are not supported by the write(2)
      // system call
      return write(self.fd, buf, off, len);
    };

    self._readImpl = function(buf, off, len, calledByIOWatcher) {
      return read(self.fd, buf, off, len);
    };
  }

  self._shutdownImpl = function() {
    shutdown(self.fd, 'write')
  };

  if (self.secure) {
    var oldWrite = self._writeImpl;
    self._writeImpl = function(buf, off, len, fd, flags) {
      assert(buf);
      assert(self.secure);

      var bytesWritten = self.secureStream.writeInject(buf, off, len);

      if (!securePool) {
        allocNewSecurePool();
      }

      var secureLen = self.secureStream.writeExtract(
        securePool, 0, securePool.length
      );

      if (secureLen == -1) {
        // Check our read again for secure handshake
        self._readWatcher.callback();
      } else {
        oldWrite(securePool, 0, secureLen, fd, flags);
      }

      if (!self.secureEstablished && self.secureStream.isInitFinished()) {
        self.secureEstablished = true;

        if (self._events && self._events['secure']) {
          self.emit('secure');
        }
      }

      return bytesWritten;
    };

    var oldRead = self._readImpl;
    self._readImpl = function(buf, off, len, calledByIOWatcher) {
      assert(self.secure);

      var bytesRead = 0;
      var secureBytesRead = null;

      if (!securePool) {
        allocNewSecurePool();
      }

      if (calledByIOWatcher) {
        secureBytesRead = oldRead(securePool, 0, securePool.length);
        self.secureStream.readInject(securePool, 0, secureBytesRead);
      }

      var chunkBytes;
      do {
        chunkBytes = self.secureStream.readExtract(
          pool,
          pool.used + bytesRead,
          pool.length - pool.used - bytesRead
        );

        bytesRead += chunkBytes;
      } while ((chunkBytes > 0) && (pool.used + bytesRead < pool.length));

      if (bytesRead == 0 && !calledByIOWatcher) {
        return -1;
      }

      if (self.secureStream.readPending()) {
        process.nextTick(function () {
          if(self._readWatcher)
            self._readWatcher.callback();
        });
      }

      if (!self.secureEstablished) {
        if (self.secureStream.isInitFinished()) {
          self.secureEstablished = true;
          if (self._events && self._events['secure']) {
            self.emit('secure');
          }
        }
      }

      if (calledByIOWatcher && secureBytesRead === null && !self.server) {
        // Client needs to write as part of handshake
        self._writeWatcher.start();
        return -1;
      }

      if (bytesRead == 0 && secureBytesRead > 0) {
        // Deal with SSL handshake
        if (self.server) {
          self._checkForSecureHandshake();
        } else {
          if (self.secureEstablised) {
            self.flush();
          } else {
            self._checkForSecureHandshake();
          }
        }

        return -1;
      }

      return bytesRead;
    };

    var oldShutdown = self._shutdownImpl;
    self._shutdownImpl = function() {
      self.secureStream.shutdown();

      if (!securePool) {
        allocNewSecurePool();
      }

      var secureLen = self.secureStream.writeExtract(
        securePool, 0, securePool.length
      );

      try {
        oldWrite(securePool, 0, secureLen);
      } catch (e) { }

      oldShutdown();
    };
  }
};

function initStream (self) {
  self._readWatcher = ioWatchers.alloc();
  self._readWatcher.callback = function () {
    // If this is the first recv (pool doesn't exist) or we've used up
    // most of the pool, allocate a new one.
    if (!pool || pool.length - pool.used < kMinPoolSpace) {
      // discard the old pool. Can't add to the free list because
      // users might have refernces to slices on it.
      pool = null;
      allocNewPool();
    }

    //debug('pool.used ' + pool.used);
    var bytesRead;

    try {
      bytesRead = self._readImpl(pool, pool.used, pool.length - pool.used, (arguments.length > 0));
    } catch (e) {
      self.destroy(e);
      return;
    }

    // Note that some _readImpl() implementations return -1 bytes
    // read as an indication not to do any processing on the result
    // (but not an error).

    if (bytesRead === 0) {
      self.readable = false;
      self._readWatcher.stop();

      if (!self.writable) self.destroy();
      // Note: 'close' not emitted until nextTick.

      if (self._events && self._events['end']) self.emit('end');
      if (self.onend) self.onend();
    } else if (bytesRead > 0) {

      timeout.active(self);

      var start = pool.used;
      var end = pool.used + bytesRead;
      pool.used += bytesRead;

      if (self._decoder) {
        // emit String
        var string = self._decoder.write(pool.slice(start, end));
        if (string.length) self.emit('data', string);
      } else {
        // emit buffer
        if (self._events && self._events['data']) {
          // emit a slice
          self.emit('data', pool.slice(start, end));
        }
      }

      // Optimization: emit the original buffer with end points
      if (self.ondata) self.ondata(pool, start, end);
    } else if (bytesRead == -2) {
      // Temporary fix - need SSL refactor.
      // -2 originates from SecureStream::ReadExtract
      self.destroy(new Error('openssl read error'));
      return false;
    }
  };
  self.readable = false;

  // Queue of buffers and string that need to be written to socket.
  self._writeQueue = [];
  self._writeQueueEncoding = [];
  self._writeQueueFD = [];

  self._writeWatcher = ioWatchers.alloc();
  self._writeWatcher.socket = self;
  self._writeWatcher.callback = _doFlush;
  self.writable = false;
}

function Stream (fd, type) {
  if (!(this instanceof Stream)) return new Stream(fd, type);
  events.EventEmitter.call(this);

  this.fd = null;
  this.type = null;
  this.secure = false;

  if (parseInt(fd) >= 0) {
    this.open(fd, type);
  } else {
    setImplmentationMethods(this);
  }
};
sys.inherits(Stream, events.EventEmitter);
exports.Stream = Stream;

Stream.prototype.setSecure = function(credentials) {
  if (!have_crypto) {
    throw new Error('node.js not compiled with openssl crypto support.');
  }
  var crypto= require("crypto");
  this.secure = true;
  this.secureEstablished = false;
  // If no credentials given, create a new one for just this Stream
  if (!credentials) {
    this.credentials = crypto.createCredentials();
  } else {
    this.credentials = credentials;
  }
  if (!this.server) {
    // For clients, we will always have either a given ca list or the default one;
    this.credentials.shouldVerify = true;
  }
  this.secureStream = new SecureStream(this.credentials.context, this.server ? 1 : 0, this.credentials.shouldVerify ? 1 : 0);

  setImplmentationMethods(this);

  if (!this.server) {
    // If client, trigger handshake
    this._checkForSecureHandshake();
  }
}


Stream.prototype.verifyPeer = function() {
  if (!this.secure) {
    throw new Error('Stream is not a secure stream.');
  }
  return this.secureStream.verifyPeer(this.credentials.context);
}


Stream.prototype._checkForSecureHandshake = function() {
  if (!this.writable) {
    return;
  }

  // Do an empty write to see if we need to write out as part of handshake
  if (!emptyBuffer) allocEmptyBuffer();
  this.write(emptyBuffer);
}


Stream.prototype.getPeerCertificate = function(credentials) {
  if (!this.secure) {
    throw new Error('Stream is not a secure stream.');
  }
  return this.secureStream.getPeerCertificate();
}


Stream.prototype.getCipher = function() {
  if (!this.secure) {
      throw new Error('Stream is not a secure stream.');
  }
  return this.secureStream.getCurrentCipher();
}


Stream.prototype.open = function (fd, type) {
  initStream(this);

  this.fd = fd;
  this.type = type || null;
  this.readable = true;

  setImplmentationMethods(this);

  this._writeWatcher.set(this.fd, false, true);
  this.writable = true;
}


exports.createConnection = function (port, host) {
  var s = new Stream();
  s.connect(port, host);
  return s;
};


Object.defineProperty(Stream.prototype, 'readyState', {
  get: function () {
    if (this._connecting) {
      return 'opening';
    } else if (this.readable && this.writable) {
      assert(typeof this.fd == 'number');
      return 'open';
    } else if (this.readable && !this.writable){
      assert(typeof this.fd == 'number');
      return 'readOnly';
    } else if (!this.readable && this.writable){
      assert(typeof this.fd == 'number');
      return 'writeOnly';
    } else {
      assert(typeof this.fd != 'number');
      return 'closed';
    }
  }
});


// Returns true if all the data was flushed to socket. Returns false if
// something was queued. If data was queued, then the "drain" event will
// signal when it has been finally flushed to socket.
Stream.prototype.write = function (data, encoding, fd) {
  if (this._connecting || (this._writeQueue && this._writeQueue.length)) {
    if (!this._writeQueue) {
      this._writeQueue = [];
      this._writeQueueEncoding = [];
      this._writeQueueFD = [];
    }

    // Slow. There is already a write queue, so let's append to it.
    if (this._writeQueueLast() === END_OF_FILE) {
      throw new Error('Stream.end() called already; cannot write.');
    }

    if (typeof data == 'string' &&
        this._writeQueue.length &&
        typeof this._writeQueue[this._writeQueue.length-1] === 'string' &&
        this._writeQueueEncoding[this._writeQueueEncoding.length-1] === encoding) {
      // optimization - concat onto last
      this._writeQueue[this._writeQueue.length-1] += data;
    } else {
      this._writeQueue.push(data);
      this._writeQueueEncoding.push(encoding);
    }

    if (fd != undefined) {
      this._writeQueueFD.push(fd);
    }

    return false;
  } else {
    // Fast.
    // The most common case. There is no write queue. Just push the data
    // directly to the socket.
    return this._writeOut(data, encoding, fd);
  }
};

// Directly writes the data to socket.
//
// Steps:
//   1. If it's a string, write it to the `pool`. (If not space remains
//      on the pool make a new one.)
//   2. Write data to socket. Return true if flushed.
//   3. Slice out remaining
//   4. Unshift remaining onto _writeQueue. Return false.
Stream.prototype._writeOut = function (data, encoding, fd) {
  if (!this.writable) {
    throw new Error('Stream is not writable');
  }

  var buffer, off, len;
  var bytesWritten, charsWritten;
  var queuedData = false;

  if (typeof data != 'string') {
    // 'data' is a buffer, ignore 'encoding'
    buffer = data;
    off = 0;
    len = data.length;

  } else {
    assert(typeof data == 'string')

    if (!pool || pool.length - pool.used < kMinPoolSpace) {
      pool = null;
      allocNewPool();
    }

    if (!encoding || encoding == 'utf8' || encoding == 'utf-8') {
      // default to utf8
      bytesWritten = pool.write(data, 'utf8', pool.used);
      charsWritten = Buffer._charsWritten;
    } else {
      bytesWritten = pool.write(data, encoding, pool.used);
      charsWritten = bytesWritten;
    }

    if (encoding && data.length > 0) {
      assert(bytesWritten > 0);
    }

    buffer = pool;
    len = bytesWritten;
    off = pool.used;

    pool.used += bytesWritten;

    debug('wrote ' + bytesWritten + ' bytes to pool');

    if (charsWritten != data.length) {
      //debug("couldn't fit " + (data.length - charsWritten) + " bytes into the pool\n");
      // Unshift whatever didn't fit onto the buffer
      this._writeQueue.unshift(data.slice(charsWritten));
      this._writeQueueEncoding.unshift(encoding);
      this._writeWatcher.start();
      queuedData = true;
    }
  }

  try {
    bytesWritten = this._writeImpl(buffer, off, len, fd, 0);
  } catch (e) {
    this.destroy(e);
    return false;
  }

  debug('wrote ' + bytesWritten + ' to socket. [fd, off, len] = ' + JSON.stringify([this.fd, off, len]) + "\n");

  timeout.active(this);

  if (bytesWritten == len) {
    // awesome. sent to buffer.
    if (buffer === pool) {
      // If we're just writing from the pool then we can make a little
      // optimization and save the space.
      buffer.used -= len;
    }

    if (queuedData) {
      return false;
    } else {
      return true;
    }
  }

  // Didn't write the entire thing to buffer.
  // Need to wait for the socket to become available before trying again.
  this._writeWatcher.start();

  // Slice out the data left.
  var leftOver = buffer.slice(off + bytesWritten, off + len);
  leftOver.used = leftOver.length; // used the whole thing...

  //  sys.error('data.used = ' + data.used);
  //if (!this._writeQueue) initWriteStream(this);

  // data should be the next thing to write.
  this._writeQueue.unshift(leftOver);
  this._writeQueueEncoding.unshift(null);

  // If didn't successfully write any bytes, enqueue our fd and try again
  if (!bytesWritten) {
    this._writeQueueFD.unshift(fd);
  }

  return false;
}


// Flushes the write buffer out.
// Returns true if the entire buffer was flushed.
Stream.prototype.flush = function () {
  while (this._writeQueue && this._writeQueue.length) {
    var data = this._writeQueue.shift();
    var encoding = this._writeQueueEncoding.shift();
    var fd = this._writeQueueFD.shift();

    if (data === END_OF_FILE) {
      this._shutdown();
      return true;
    }

    var flushed = this._writeOut(data,encoding,fd);
    if (!flushed) return false;
  }
  if (this._writeWatcher) this._writeWatcher.stop();
  return true;
};


Stream.prototype.send = function () {
  throw new Error('send renamed to write');
};


Stream.prototype._writeQueueLast = function () {
  return this._writeQueue.length > 0 ? this._writeQueue[this._writeQueue.length-1]
                                     : null;
};


Stream.prototype.setEncoding = function (encoding) {
  var StringDecoder = require("string_decoder").StringDecoder; // lazy load
  this._decoder = new StringDecoder(encoding);
};


function doConnect (socket, port, host) {
  try {
    connect(socket.fd, port, host);
  } catch (e) {
    socket.destroy(e);
    return;
  }

  debug('connecting to ' + host + ' : ' + port);

  // Don't start the read watcher until connection is established
  socket._readWatcher.set(socket.fd, true, false);

  // How to connect on POSIX: Wait for fd to become writable, then call
  // socketError() if there isn't an error, we're connected. AFAIK this a
  // platform independent way determining when a non-blocking connection
  // is established, but I have only seen it documented in the Linux
  // Manual Page connect(2) under the error code EINPROGRESS.
  socket._writeWatcher.set(socket.fd, false, true);
  socket._writeWatcher.start();
  socket._writeWatcher.callback = function () {
    var errno = socketError(socket.fd);
    if (errno == 0) {
      // connection established
      socket._connecting = false;
      socket.resume();
      socket.readable = socket.writable = true;
      socket._writeWatcher.callback = _doFlush;
      try {
        socket.emit('connect');
      } catch (e) {
        socket.destroy(e);
        return;
      }


      if (socket._writeQueue && socket._writeQueue.length) {
        // Flush socket in case any writes are queued up while connecting.
        // ugly
        _doFlush.call(socket._writeWatcher);
      }

    } else if (errno != EINPROGRESS) {
      socket.destroy(errnoException(errno, 'connect'));
    }
  };
}

function toPort (x) { return (x = Number(x)) >= 0 ? x : false }


// var stream = new Stream();
// stream.connect(80)               - TCP connect to port 80 on the localhost
// stream.connect(80, 'nodejs.org') - TCP connect to port 80 on nodejs.org
// stream.connect('/tmp/socket')    - UNIX connect to socket specified by path
Stream.prototype.connect = function () {
  var self = this;
  initStream(self);
  if (self.fd) throw new Error('Stream already opened');
  if (!self._readWatcher) throw new Error('No readWatcher');

  timeout.active(socket);

  self._connecting = true; // set false in doConnect
  self.writable = true;

  var port = toPort(arguments[0])
  if (port === false) {
    // UNIX
    self.fd = socket('unix');
    self.type = 'unix';

    setImplmentationMethods(this);
    doConnect(self, arguments[0]);
  } else {
    // TCP
    dns.lookup(arguments[1], function (err, ip, addressType) {
      if (err) {
        self.emit('error', err);
      } else {
        self.type = addressType == 4 ? 'tcp4' : 'tcp6';
        self.fd = socket(self.type);
        doConnect(self, port, ip);
      }
    });
  }
};


Stream.prototype.address = function () {
  return getsockname(this.fd);
};


Stream.prototype.setNoDelay = function (v) {
  if ((this.type == 'tcp4')||(this.type == 'tcp6')) {
    setNoDelay(this.fd, v);
  }
};

Stream.prototype.setKeepAlive = function (enable, time) {
  if ((this.type == 'tcp4')||(this.type == 'tcp6')) {
    var secondDelay = Math.ceil(time/1000);
    setKeepAlive(this.fd, enable, secondDelay);
  }
};

Stream.prototype.setTimeout = function (msecs) {
  if (msecs > 0) {
    timeout.enroll(this, msecs);
    if (this.fd) { timeout.active(this); }
  } else if (msecs === 0) {
    timeout.unenroll(this);
  }
};


Stream.prototype.pause = function () {
  this._readWatcher.stop();
};


Stream.prototype.resume = function () {
  if (this.fd === null) throw new Error('Cannot resume() closed Stream.');
  this._readWatcher.set(this.fd, true, false);
  this._readWatcher.start();
};


var forceCloseWarning;

Stream.prototype.forceClose = function (e) {
  if (!forceCloseWarning) {
    forceCloseWarning = "forceClose() has been renamed to destroy()";
    sys.error(forceCloseWarning);
  }
  return this.destroy(e);
};


Stream.prototype.destroy = function (exception) {
  // pool is shared between sockets, so don't need to free it here.
  var self = this;

  // TODO would like to set _writeQueue to null to avoid extra object alloc,
  // but lots of code assumes this._writeQueue is always an array.
  this._writeQueue = [];

  this.readable = this.writable = false;

  if (this._writeWatcher) {
    this._writeWatcher.stop();
    ioWatchers.free(this._writeWatcher);
    this._writeWatcher = null;
  }

  if (this._readWatcher) {
    this._readWatcher.stop();
    ioWatchers.free(this._readWatcher);
    this._readWatcher = null;
  }

  timeout.unenroll(this);

  if (this.secure) {
    this.secureStream.close();
  }

  if (this.server) {
    this.server.connections--;
  }

  // FIXME Bug when this.fd == 0
  if (typeof this.fd == 'number') {
    close(this.fd);
    this.fd = null;
    process.nextTick(function () {
      if (exception) self.emit('error', exception);
      self.emit('close', exception ? true : false);
    });
  }
};


Stream.prototype._shutdown = function () {
  if (!this.writable) {
    throw new Error('The connection is not writable');
  } else {
    if (this.readable) {
      // readable and writable
      this.writable = false;

      try {
        this._shutdownImpl();
      } catch (e) {
        this.destroy(e);
      }
    } else {
      // writable but not readable
      this.destroy();
    }
  }
};

var closeDepricationWarning;

Stream.prototype.close = function (data, encoding) {
  if (!closeDepricationWarning) {
    closeDepricationWarning = "Notification: Stream.prototype.close has been renamed to end()";
    sys.error(closeDepricationWarning);
  }
  return this.end(data, encoding);
};

Stream.prototype.end = function (data, encoding) {
  if (this.writable) {
    if (data) this.write(data, encoding);
    if (this._writeQueueLast() !== END_OF_FILE) {
      this._writeQueue.push(END_OF_FILE);
      if (!this._connecting) {
        this.flush();
      }
    }
  }
};


function Server (listener) {
  if (!(this instanceof Server)) return new Server(listener);
  events.EventEmitter.call(this);
  var self = this;

  if (listener) {
    self.addListener('connection', listener);
  }

  self.connections = 0;

  self.paused = false;
  self.pauseTimeout = 1000;

  function pause () {
    // We've hit the maximum file limit. What to do?
    // Let's try again in 1 second.
    self.watcher.stop();

    // If we're already paused, don't do another timeout.
    if (self.paused) return;

    setTimeout(function () {
      self.paused = false;
      // Make sure we haven't closed in the interim
      if (typeof self.fd  != 'number') return;
      self.watcher.start();
    }, self.pauseTimeout);
  }

  self.watcher = new IOWatcher();
  self.watcher.host = self;
  self.watcher.callback = function () {
    // Just in case we don't have a dummy fd.
    getDummyFD();

    if (self._pauseTimer) {
      // Somehow the watcher got started again. Need to wait until
      // the timer finishes.
      self.watcher.stop();
    }

    while (self.fd) {
      try {
        var peerInfo = accept(self.fd);
      } catch (e) {
        if (e.errno != EMFILE) throw e;

        // Gracefully reject pending clients by freeing up a file
        // descriptor.
        rescueEMFILE(function() {
          self._rejectPending();
        });
        return;
      }
      if (!peerInfo) return;

      if (self.maxConnections && self.connections >= self.maxConnections) {
        // Close the connection we just had
        close(peerInfo.fd);
        // Reject all other pending connectins.
        self._rejectPending();
        return;
      }

      self.connections++;

      var s = new Stream(peerInfo.fd, self.type);
      s.remoteAddress = peerInfo.address;
      s.remotePort = peerInfo.port;
      s.type = self.type;
      s.server = self;
      s.resume();

      self.emit('connection', s);

      // The 'connect' event  probably should be removed for server-side
      // sockets. It's redundant.
      try {
        s.emit('connect');
      } catch (e) {
        s.destroy(e);
        return;
      }
    }
  };
}
sys.inherits(Server, events.EventEmitter);
exports.Server = Server;


exports.createServer = function (listener) {
  return new Server(listener);
};


// Just stop trying to accepting connections for a while.
// Useful for throttling against DoS attacks.
Server.prototype.pause = function (msecs) {
  // We're already paused.
  if (this._pauseTimer) return;

  var self = this;
  msecs = msecs || 1000;

  this.watcher.stop();

  // Wait a second before accepting more.
  this._pauseTimer = setTimeout(function () {
    // Our fd should still be there. If someone calls server.close() then
    // the pauseTimer should be cleared.
    assert(parseInt(self.fd) >= 0);
    self._pauseTimer = null;
    self.watcher.start();
  }, msecs);
};


Server.prototype._rejectPending = function () {
  var self = this;
  var acceptCount = 0;
  // Accept and close the waiting clients one at a time.
  // Single threaded programming ftw.
  while (true) {
    peerInfo = accept(this.fd);
    if (!peerInfo) return;
    close(peerInfo.fd);

    // Don't become DoS'd by incoming requests
    if (++acceptCount > 50) {
      this.pause();
      return;
    }
  }
};


// Listen on a UNIX socket
// server.listen("/tmp/socket");
//
// Listen on port 8000, accept connections from INADDR_ANY.
// server.listen(8000);
//
// Listen on port 8000, accept connections to "192.168.1.2"
// server.listen(8000, "192.168.1.2");
Server.prototype.listen = function () {
  var self = this;
  if (self.fd) throw new Error('Server already opened');

  var lastArg = arguments[arguments.length - 1];
  if (typeof lastArg == 'function') {
    self.addListener('listening', lastArg);
  }

  var port = toPort(arguments[0])
  if (port === false) {
    // the first argument specifies a path
    self.fd = socket('unix');
    self.type = 'unix';
    var path = arguments[0];
    self.path = path;
    // unlink sockfile if it exists
    fs.stat(path, function (err, r) {
      if (err) {
        if (err.errno == ENOENT) {
          bind(self.fd, path);
          self._doListen();
        } else {
          throw r;
        }
      } else {
        if (!r.isSocket()) {
          throw new Error("Non-socket exists at  " + path);
        } else {
          fs.unlink(path, function (err) {
            if (err) {
              throw err;
            } else {
              bind(self.fd, path);
              self._doListen();
            }
          });
        }
      }
    });
  } else if (!arguments[1]) {
    // Don't bind(). OS will assign a port with INADDR_ANY.
    // The port can be found with server.address()
    self.type = 'tcp4';
    self.fd = socket(self.type);
    bind(self.fd, port);
    process.nextTick(function () {
      self._doListen();
    });
  } else {
    // the first argument is the port, the second an IP
    dns.lookup(arguments[1], function (err, ip, addressType) {
      if (err) {
        self.emit('error', err);
      } else {
        self.type = addressType == 4 ? 'tcp4' : 'tcp6';
        self.fd = socket(self.type);
        bind(self.fd, port, ip);
        self._doListen();
      }
    });
  }
};

Server.prototype.listenFD = function (fd, type) {
  if (this.fd) {
    throw new Error('Server already opened');
  }

  this.fd = fd;
  this.type = type || null;
  this._startWatcher();
};

Server.prototype._startWatcher = function () {
  this.watcher.set(this.fd, true, false);
  this.watcher.start();
  this.emit("listening");
};

Server.prototype._doListen = function () {
  // Ensure we have a dummy fd for EMFILE conditions.
  getDummyFD();

  listen(this.fd, 128);
  this._startWatcher();
}



Server.prototype.address = function () {
  return getsockname(this.fd);
};


Server.prototype.close = function () {
  var self = this;
  if (!self.fd) throw new Error('Not running');

  self.watcher.stop();

  close(self.fd);
  self.fd = null;

  if (self._pauseTimer) {
    clearTimeout(self._pauseTimer);
    self._pauseTimer = null;
  }

  if (self.type === "unix") {
    fs.unlink(self.path, function () {
      self.emit("close");
    });
  } else {
    self.emit("close");
  }
};


var dummyFD = null;
var lastEMFILEWarning = 0;
// Ensures to have at least on free file-descriptor free.
// callback should only use 1 file descriptor and close it before end of call
function rescueEMFILE(callback) {
  // Output a warning, but only at most every 5 seconds.
  var now = new Date();
  if (now - lastEMFILEWarning > 5000) {
    console.error("(node) Hit max file limit. Increase 'ulimit -n'.");
    lastEMFILEWarning = now;
  }

  if (dummyFD) {
    close(dummyFD);
    dummyFD = null;
    callback();
    getDummyFD();
  }
}

function getDummyFD() {
  if (!dummyFD) {
    try {
      dummyFD = socket("tcp");
    } catch (e) {
      dummyFD = null;
    }
  }
}
