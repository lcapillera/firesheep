//
// FiresheepSession.js
// Part of the Firesheep project.
//
// Copyright (C) 2010 Eric Butler
//
// Authors:
//   Eric Butler <eric@codebutler.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import('resource://firesheep/util/Observers.js');
Cu.import('resource://firesheep/util/Utils.js');
Cu.import('resource://firesheep/FiresheepWorker.js');

var EXPORTED_SYMBOLS = [ 'FiresheepSession' ];

function FiresheepSession (fs, iface, filter) {
  this._core        = fs;
  this._iface       = iface;
  this._filter      = filter;
  this._resultCache = {};
  this._handlers    = fs.handlers;
}

FiresheepSession.prototype = {
  start: function () {
    try {
      if (this.isCapturing)
        return;

      var em = Cc["@mozilla.org/extensions/manager;1"].getService(Ci.nsIExtensionManager);
      
      var file = em.getInstallLocation("firesheep@codebutler.com").location;
      file.append("firesheep@codebutler.com");
      file.append("backend");
      file.append("firesheep-backend");
      
      var path = file.path;
      
      // Ensure the process is actually executable.
      // FIXME: Make this better in future.
      Utils.runCommand('chmod', [ 'a+x', path ]);
      
      // FIXME: This will only work on OSX! 
      // Should probably write an XPCOM component that wraps stat(2) instead.
      // This is needed because nsILocalFile.permissions doesn't include the 
      // setuid bit (and that aside, there's no way to get owner).
      var result = Utils.runCommand('stat', ['-f', '%p %u', path ]);
      result = result.split(' ');
      var mode = parseInt(result[0], 8);
      var uid  = result[1];
      
      /* If permissions need fixing, run backend once in advance so it can take care of things. */
      if ((mode & 0004000 /* S_ISUID */) == 0 || uid != 0) {
        this._process = Cc["@codebutler.com/mozpopen/process;1"].createInstance(Ci.IMozPopenProcess);
        this._process.Init(path, [ this._iface, this._filter ], 2);
        this._process.Start();
        var exitCode = this._process.Wait();
        if (exitCode != 0) {
          throw "Failed to fix permissions";
        }
      }
      
      this._process = Cc["@codebutler.com/mozpopen/process;1"].createInstance(Ci.IMozPopenProcess);
      this._process.Init(path, [ this._iface, this._filter ], 2);

      this._process.Start();
      if (this._process.IsRunning()) {
        this._thread = Cc["@mozilla.org/thread-manager;1"].getService().newThread(0);
        this._thread.dispatch(new FiresheepWorker(this), Ci.nsIThread.DISPATCH_NORMAL);
      } else {
        throw "Failed to start capture.";
      }
    } catch (e) {
      this.handleError(e);
    }
  },
  
  stop: function () {
    if (!this.isCapturing)
      return;

    if (this._process.IsRunning())
      this._process.Stop();

    this._process = null;
    this._thread = null;
  
    Observers.notify('Firesheep', { action: 'capture_stopped' });
  },
  
  get isCapturing () {
    return !!this._process
  },
  
  /* Called by worker */
  postResult: function (result) {
    this._core._handleResult.apply(this._core, [ result ]);
  },
  
  handleError: function (e) {
    dump('Error: ' + e + '\n');
    this.stop();
    Observers.notify('Firesheep', { action: 'error', error: e });
  }
};