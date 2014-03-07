/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
 
var CONFIG = {
  clientId: '393543457271-spltqcu9l759t4q2u8m7ivb725shtvhp.apps.googleusercontent.com',
  apiKey: 'AIzaSyBL_11-9poO9atg61MbMdjcO9VCiXyn950',
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.install'
  ]
};

var app = {};

app.module = angular.module('todos', []);

/**
 * A simple type for todo items.
 * @constructor
 */
app.Todo = function () {
};

/**
 * Initializer for constructing via the realtime API
 *
 * @param title
 */
app.Todo.prototype.initialize = function (title) {
  var model = gapi.drive.realtime.custom.getModel(this);
  this.title = model.createString(title);
  this.completed = false;
};


/**
 * Loads the document. Used to inject the collaborative document
 * into the main controller.
 *
 * @param $route
 * @param storage
 * @returns {*}
 */
app.loadFile = function ($route, storage) {
  var id = $route.current.params.fileId;
  var userId = $route.current.params.user;
  return storage.requireAuth(true, userId).then(function () {
    return storage.getDocument(id);
  });
};
app.loadFile.$inject = ['$route', 'storage'];

/**
 * Initialize our application routes
 */
app.module.config(['$routeProvider',
  function ($routeProvider) {
    $routeProvider
      .when('/todos/:fileId/:filter', {
        templateUrl: 'views/main.html',
        controller: 'MainCtrl',
        resolve: {
          realtimeDocument: app.loadFile
        }
      })
      .when('/create', {
        templateUrl: 'views/loading.html',
        controller: 'CreateCtrl'
      })
      .when('/install', {
        templateUrl: 'views/install.html',
        controller: 'InstallCtrl'
      })
      .otherwise({
        redirectTo: '/install'
      });
  }]
);

app.module.value('config', CONFIG);

/**
 * Set up handlers for various authorization issues that may arise if the access token
 * is revoked or expired.
 */
app.module.run(['$rootScope', '$location', 'storage', function ($rootScope, $location, storage) {
  // Error loading the document, likely due revoked access. Redirect back to home/install page
  $rootScope.$on('$routeChangeError', function () {
    $location.url('/install?target=' + encodeURIComponent($location.url()));
  });

  // Token expired, refresh
  $rootScope.$on('todos.token_refresh_required', function () {
    storage.requireAuth(true).then(function () {
      // no-op
    }, function () {
      $location.url('/install?target=' + encodeURIComponent($location.url()));
    });
  });
}]);

/**
 * Bootstrap the app
 */
gapi.load('auth:client:drive-share:drive-realtime', function () {
  gapi.auth.init();

  // Monkey patch collaborative string for ng-model compatibility
  Object.defineProperty(gapi.drive.realtime.CollaborativeString.prototype, 'text', {
    set: function (value) {
      return this.setText(value);
    },
    get: function () {
      return this.getText();
    }
  });

  // Register our Todo class
  app.Todo.prototype.title = gapi.drive.realtime.custom.collaborativeField('title');
  app.Todo.prototype.completed = gapi.drive.realtime.custom.collaborativeField('completed');
  gapi.drive.realtime.custom.registerType(app.Todo, 'todo');
  gapi.drive.realtime.custom.setInitializer(app.Todo, app.Todo.prototype.initialize);

  $(document).ready(function () {
    angular.bootstrap(document, ['todos']);
  });
});

/**
 * storage module
 */
angular.module('todos').service('storage', ['$q', '$rootScope', 'config',
  /**
   * Handles document creation & loading for the app. Keeps only
   * one document loaded at a time.
   *
   * @param $q
   * @param $rootScope
   * @param config
   */
  function ($q, $rootScope, config) {
    this.id = null;
    this.document = null;

    /**
     * Close the current document.
     */
    this.closeDocument = function () {
      this.document.close();
      this.document = null;
      this.id = null;
    };

    /**
     * Ensure the document is loaded.
     *
     * @param id
     * @returns {angular.$q.promise}
     */
    this.getDocument = function (id) {
      if (this.id === id) {
        return $q.when(this.document);
      } else if (this.document) {
        this.closeDocument();
      }
      return this.load(id);
    };

    /**
     * Creates a new document.
     *
     * @param title
     * @returns {angular.$q.promise}
     */
    this.createDocument = function (title) {
      var deferred = $q.defer();
      var onComplete = function (result) {
        if (result && !result.error) {
          deferred.resolve(result);
        } else {
          deferred.reject(result);
        }
        $rootScope.$digest();
      };
      gapi.client.request({
        'path': '/drive/v2/files',
        'method': 'POST',
        'body': JSON.stringify({
          title: title,
          mimeType: 'application/vnd.google-apps.drive-sdk'
        })
      }).execute(onComplete);
      return deferred.promise;
    };

    /**
     * Checks to make sure the user is currently authorized and the access
     * token hasn't expired.
     *
     * @param immediateMode
     * @param userId
     * @returns {angular.$q.promise}
     */
    this.requireAuth = function (immediateMode, userId) {
      /* jshint camelCase: false */
      var token = gapi.auth.getToken();
      var now = Date.now() / 1000;
      if (token && ((token.expires_at - now) > (60))) {
        return $q.when(token);
      } else {
        var params = {
          'client_id': config.clientId,
          'scope': config.scopes,
          'immediate': immediateMode,
          'user_id': userId
        };
        var deferred = $q.defer();
        gapi.auth.authorize(params, function (result) {
          if (result && !result.error) {
            deferred.resolve(result);
          } else {
            deferred.reject(result);
          }
          $rootScope.$digest();
        });
        return deferred.promise;
      }
    };

    /**
     * Actually load a document. If the document is new, initializes
     * the model with an empty list of todos.
     *
     * @param id
     * @returns {angular.$q.promise}
     */
    this.load = function (id) {
      var deferred = $q.defer();
      var initialize = function (model) {
        model.getRoot().set('todos', model.createList());
      };
      var onLoad = function (document) {
        this.setDocument(id, document);
        deferred.resolve(document);
        $rootScope.$digest();
      }.bind(this);
      var onError = function (error) {
        if (error.type === gapi.drive.realtime.ErrorType.TOKEN_REFRESH_REQUIRED) {
          $rootScope.$emit('todos.token_refresh_required');
        } else if (error.type === gapi.drive.realtime.ErrorType.CLIENT_ERROR) {
          $rootScope.$emit('todos.client_error');
        } else if (error.type === gapi.drive.realtime.ErrorType.NOT_FOUND) {
          deferred.reject(error);
          $rootScope.$emit('todos.not_found', id);
        }
        $rootScope.$digest();
      };
      gapi.drive.realtime.load(id, onLoad, initialize, onError);
      return deferred.promise;
    };

    /**
     * Watches the model for any remote changes to force a digest cycle
     *
     * @param event
     */
    this.changeListener = function (event) {
      if (!event.isLocal) {
        $rootScope.$digest();
      }
    };

    this.setDocument = function (id, document) {
      document.getModel().getRoot().addEventListener(
        gapi.drive.realtime.EventType.OBJECT_CHANGED,
        this.changeListener);
      this.document = document;
      this.id = id;
    };
  }]
);

/**
 * Collaborative
 */
angular.module('todos').directive('collaborative',
  /**
   * Directive for adding cursor management to text fields bound to
   * collaboraative strings. Regular data binding works fine without it,
   * but remote updates will not properly maintain the cursor. Including
   * this directive ensures correct logical positioning of the cursor
   * on active fields.
   *
   * @returns {{restrict: string, scope: boolean, require: string, compile: Function}}
   */
  function () {
    /**
     * Handles the cursor management for a text field.
     *
     * @param scope
     * @param element
     * @param string
     * @param controller
     * @constructor
     */
    var TextBinder = function (scope, element, string, controller) {
      this.element = element;
      this.string = string;
      this.scope = scope;

      this._insertListener = angular.bind(this, function (event) {
        if (!event.isLocal) {
          this.updateText(event.index, event.text.length);
        }
      });
      this._deleteListener = angular.bind(this, function (event) {
        if (!event.isLocal) {
          this.updateText(event.index, -event.text.length);
        }
      });
      this.updateText = function (position, size) {
        var element = this.element[0];
        var isActive = (element === document.activeElement);
        if (isActive) {
          var value = this.string.text;
          var selectionStart = element.selectionStart;
          var selectionEnd = element.selectionEnd;

          if (position <= selectionStart) {
            selectionStart += size;
          }
          if (position < selectionEnd) {
            selectionEnd += size;
          }
          if (selectionEnd < selectionStart) {
            selectionEnd = selectionStart;
          }

          scope.$apply(function () {
            // Copied from ngModelController
            var formatters = controller.$formatters;
            var idx = formatters.length;

            controller.$modelValue = value;
            while (idx--) {
              value = formatters[idx](value);
            }

            if (controller.$viewValue !== value) {
              controller.$viewValue = value;
              controller.$render();
            }
            element.setSelectionRange(selectionStart, selectionEnd);
          });

        }
      };

      this.unbind = function () {
        console.log('Removing listeners');
        this.string.removeEventListener(gapi.drive.realtime.EventType.TEXT_INSERTED, this._insertListener);
        this.string.removeEventListener(gapi.drive.realtime.EventType.TEXT_DELETED, this._deleteListener);
      };

      this.string.addEventListener(gapi.drive.realtime.EventType.TEXT_INSERTED, this._insertListener);
      this.string.addEventListener(gapi.drive.realtime.EventType.TEXT_DELETED, this._deleteListener);
    };

    return {
      restrict: 'A',
      scope: false,
      require: 'ngModel',
      compile: function (tElement, tAttrs) {
        var expression = tAttrs.ngModel.replace(/\.text$/, '');
        if (expression === tAttrs.ngModel) {
          console.log('Model does not appear to be collaborative string. Bind ng-model to .text property');
          return null;
        }
        return function (scope, iElement, iAttrs, controller) {
          scope.$watch(expression, function (newValue) {
            if (scope.binder) {
              scope.binder.unbind();
            }
            if (newValue) {
              scope.binder = new TextBinder(scope, iElement, newValue, controller);
            }
          });
          scope.$on('$destroy', function () {
            if (scope.binder) {
              scope.binder.unbind();
              scope.binder = null;
            }
          });
        };
      }
    };
  }
);

/**
 * Install
 */
 angular.module('todos').controller('InstallCtrl', ['$scope', '$location', 'storage',
  /**
   * Controller for installing the app and/or re-authorizing access.
   *
   * @param {angular.Scope} $scope
   * @param {angular.$location} $location
   * @param storage
   * @constructor
   */
  function ($scope, $location, storage) {

    /**
     * Requests authorization from the user. Redirects to the previous target
     * or to create a new doc if no other action once complete.
     */
    $scope.authorize = function () {
      storage.requireAuth(false).then(function () {
        var target = $location.search().target;
        if (target) {
          $location.url(target);
        } else {
          $location.url('/create');
        }
      });
    };
  }]
);
 
/**
 * Create
 */
 angular.module('todos').controller('CreateCtrl', ['$scope', '$location', 'storage',
  /**
   * Controller for creating new documents
   *
   * @param {angular.Scope} $scope
   * @param {angular.$location} $location
   * @param {!object} storage
   * @constructor
   */
  function ($scope, $location, storage) {
    $scope.message = 'Please wait';
    storage.requireAuth().then(function () {
      storage.createDocument('New Project').then(function (file) {
        $location.url('/todos/' + file.id + '/');
      });
    }, function () {
      $location.url('/install?target=' + encodeURIComponent($location.url()));
    });
  }]
);

 
/**
 * todos
 */
 angular.module('todos').controller('MainCtrl', ['$scope', '$routeParams', 'realtimeDocument',
  /**
   * Controller for editing the tasks lists
   *
   * @param {angular.Scope} $scope
   * @param {angular.$routeParams} $routeParams
   * @param document
   * @constructor
   */
  function ($scope, $routeParams, realtimeDocument) {
    $scope.fileId = $routeParams.fileId;
    $scope.filter = $routeParams.filter;

    $scope.realtimeDocument = realtimeDocument;
    $scope.todos = realtimeDocument.getModel().getRoot().get('todos');
    $scope.newTodo = '';


    /**
     * Count the number of incomplete todo items.
     *
     * @returns {number}
     */
    $scope.remainingCount = function () {
      var remaining = 0;
      angular.forEach(this.todos.asArray(), function (todo) {
        remaining += todo.completed ? 0 : 1;
      });
      return remaining;
    };

    /**
     * Add a new todo item to the list, resets the new item text.
     */
    $scope.addTodo = function () {
      if (this.newTodo) {
        realtimeDocument.getModel().beginCompoundOperation();
        var todo = realtimeDocument.getModel().create(app.Todo, this.newTodo);
        this.newTodo = '';
        this.todos.push(todo);
        realtimeDocument.getModel().endCompoundOperation();
      }
    };

    /**
     * Begin editing of an item.
     */
    $scope.editTodo = function (todo) {
      $scope.editedTodo = todo;
    };

    /**
     * Cancel editing.
     */
    $scope.doneEditing = function () {
      $scope.editedTodo = null;
    };

    /**
     * Delete an individual todo by removing it from the list.
     *
     * @param todo
     */
    $scope.removeTodo = function (todo) {
      this.todos.removeValue(todo);
    };

    /**
     * Remove all completed todos from the list
     */
    $scope.clearDoneTodos = function () {
      var todos = this.todos;
      realtimeDocument.getModel().beginCompoundOperation();
      angular.forEach(this.todos.asArray(), function (todo) {
        if (todo.completed) {
          todos.removeValue(todo);
        }
      });
      realtimeDocument.getModel().endCompoundOperation();
    };

    /**
     * Toggle the completed status of all items.
     *
     * @param done
     */
    $scope.markAll = function (done) {
      realtimeDocument.getModel().beginCompoundOperation();
      angular.forEach(this.todos.asArray(), function (todo) {
        todo.completed = done;
      });
      realtimeDocument.getModel().endCompoundOperation();
    };

    $scope.$watch('filter', function (filter) {
      $scope.statusFilter = (filter === 'active') ?
      { completed: false } : (filter === 'completed') ?
      { completed: true } : null;
    });
    
    /**
    * Undo local changes
    */
    $scope.undo = function() {
      realtimeDocument.getModel().undo();        
    }
    
    /**
    * Check if there are undoable changes.
    * @returns {boolean}
    */
    $scope.canUndo = function() {
      return realtimeDocument.getModel().canUndo;
    }

    /**
    * Undo local changes
    */
    $scope.redo = function() {
      realtimeDocument.getModel().redo();        
    }
    
    /**
    * Check if there are redoable changes.
    * @returns {boolean}
    */
    $scope.canRedo = function() {
      return realtimeDocument.getModel().canRedo;
    }
  }]
);

angular.module('todos').controller('CollaboratorsCtrl', ['$scope', 'config',
  /**
   * Controller for displaying the list of current collaborators. Expects
   * to inherit the document from a parent scope.
   *
   * @param {angular.Scope} $scope
   * @param {object} config
   * @constructor
   */
  function ($scope, config) {
    var appId = config.clientId.split('.').shift();

    var collaboratorListener = function () {
      $scope.$apply(function () {
        $scope.collaborators = $scope.realtimeDocument.getCollaborators();
      });
    };
    $scope.collaborators = $scope.realtimeDocument.getCollaborators();

    $scope.realtimeDocument.addEventListener(gapi.drive.realtime.EventType.COLLABORATOR_LEFT, collaboratorListener);
    $scope.realtimeDocument.addEventListener(gapi.drive.realtime.EventType.COLLABORATOR_JOINED, collaboratorListener);

    $scope.$on('$destroy', function () {
      var doc = $scope.realtimeDocument;
      if (doc) {
        doc.removeEventListener(gapi.drive.realtime.EventType.COLLABORATOR_LEFT, collaboratorListener);
        doc.removeEventListener(gapi.drive.realtime.EventType.COLLABORATOR_JOINED, collaboratorListener);
      }
    });

    $scope.share = function () {
      var fileId = this.fileId;
      var client = new gapi.drive.share.ShareClient(appId);
      client.setItemIds([fileId]);
      client.showSettingsDialog();
    };

  }]
);
