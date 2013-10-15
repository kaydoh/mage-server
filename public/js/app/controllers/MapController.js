'use strict';

/*
  Handle communication between the server and the map.
  Load observations, allow users to view them, and allow them to add new ones themselves.
*/
function MapController($rootScope, $scope, $log, $http, appConstants, mageLib, IconService, UserService, DataService, MapService, LayerService, LocationService, Location, TimerService, Feature) {
  $scope.customer = appConstants.customer;
  var ds = DataService;

  $scope.locate = false;
  $scope.broadcast = false;
  $scope.loadingLayers = {};
  $scope.layerPollTime = 60000;

  /* Some map defaults */
  $scope.observation = {};

  /* Booleans for the ng-show attribues on the panels, toggling these will show and hide the map panels (i.e. layers, observation, export). */
  $scope.showSettings = true;
  $scope.showGoToAddress = false;
  $scope.showRefresh = false;
  $scope.showLocations = false;
  $scope.showExport = false;

  /* Observation related variables and enums */
  $scope.observationTab = 1;
  $scope.files = []; // pre upload
  $scope.attachments = []; // images loaded from the server
  $scope.progressVisible = false; // progress bar stuff
  $scope.progressVisible = 0;

  $scope.locationServicesEnabled = false;
  $scope.locations = [];
  $scope.locationPollTime = 5000;

  $scope.newsFeedEnabled = false;

  $scope.showListTool = false;
  $scope.iconTag = function(feature) {
    return IconService.iconHtml(feature, $scope);
  }

  $scope.currentLayerId = 0;

  $scope.setActiveFeature = function(feature, layer) {    
    $scope.activeFeature = {feature: feature, layerId: layer.id, featureId: feature.properties.OBJECTID};
    $scope.featureTableClick = {feature: feature, layerId: layer.id, featureId: feature.properties.OBJECTID};
  }

  $scope.locationClick = function(location) {
    $scope.locationTableClick = location;
    $scope.activeLocation = location;
  }

  $scope.exportLayers = [];
  $scope.baseLayers = [];
  $scope.featureLayers = [];
  $scope.imageryLayers = []; 
  $scope.startTime = new Date();
  $scope.endTime = new Date();

  LayerService.getAllLayers().
    success(function (layers, status, headers, config) {
      // Pull out all non-base map imagery layers
      $scope.imageryLayers = _.filter(layers, function(layer) {
        return layer.type == 'Imagery' && !layer.base;
      });
      // Pull out all feature layers
      $scope.featureLayers = _.filter(layers, function(layer) {
        return layer.type == 'Feature';
      });
      // Pull out all imagery layers
      $scope.baseLayers = _.filter(layers, function(layer) {
        return layer.type == 'Imagery' && layer.base;
      });
      // Pull out all the external layers
      $scope.externalLayers = _.filter(layers, function(layer) {
        return layer.type == 'External';
      });

      $scope.privateBaseLayers = _.filter($scope.baseLayers, function(layer) {
        if (layer.url.indexOf('private') == 0) {
          layer.url = layer.url + "?access_token=" + mageLib.getToken();
          return true;
        } else {
          return false;
        }
      });

      // Default the base layer to first one in the list
      $scope.baseLayer = $scope.baseLayers[0];
    });

  $scope.layerMinDate = 0;
  $scope.layerMaxDate = Date.now();
  $scope.slider = [$scope.layerMinDate, $scope.layerMaxDate];
  $scope.dateOptions = {
    showOn: "button",
    buttonImage: "img/***REMOVED***-icons/animal_issue.png",
    buttonImageOnly: true,
    dateFormat: '@'
  };

  var loadLayer = function(id) {
    $scope.loadingLayers[id] = true;

    if ($scope.layerMaxDate == $scope.slider[1]) {
      $scope.layerMaxDate = $scope.slider[1] = Date.now();
    }

    var features = Feature.getAll({layerId: id/*, startTime: moment($scope.slider[0]).utc().format("YYYY-MM-DD HH:mm:ss"), endTime: moment($scope.slider[1]).utc().format("YYYY-MM-DD HH:mm:ss")*/}, function() {
      $scope.loadingLayers[id] = false;
      console.info('loaded the features', features);
      $scope.layer.features = features;
    });

    $scope.layer = {id: id, checked: true};
  };

  $rootScope.$on('event:auth-loginConfirmed', function() {
    _.each($scope.privateBaseLayers, function(layer) {
      layer.url = layer.url.replace(/\?access_token=\w+/,"?access_token=" + mageLib.getToken());
    });
  });


  $scope.onFeatureLayer = function(layer) {
    var timerName = 'pollLayer'+layer.id;
    if (!layer.checked) {
      $scope.layer = {id: layer.id, checked: false};
      TimerService.stop(timerName);
      return;
    };

    TimerService.start(timerName, $scope.layerPollTime || 300000, function() {
      loadLayer(layer.id);
    });
  }

  $scope.$watch('layerPollTime', function() {
    if ($scope.layerPollTime && $scope.layer) {
      if ($scope.layerPollTime == 0) {
        TimerService.stop('pollLayer'+$scope.layer.id);
        return;
      }
      $scope.onFeatureLayer($scope.layer);
    }
  });

  $scope.onImageryLayer = function(layer) {
    if (layer.checked) {
      $scope.layer = layer;
    } else {
      $scope.layer = {id: layer.id, checked: false};
    }
  }

  /* Settings aka layer panel funcitons */
  $scope.openSettings = function () {
    $scope.showSettings = true;
  }

  $scope.closeSettings = function () {
    $scope.showSettings = false;
  }

  $scope.toggleLocate = function() {
    $scope.locate = !$scope.locate;

    // if I am turning off locate and broadcast is
    // on, then turn off broadcast too.
    if (!$scope.locate && $scope.broadcast) {
      $scope.toggleBroadcast();
    }
  }

  /* Locations, think Find My Friends */
  // $scope.broadcastLocation = function () {
  $scope.toggleBroadcast = function() {
    var timerName = 'broadcastLocation';
    $scope.broadcast = !$scope.broadcast;

    if ($scope.broadcast) {
      $scope.locate = true;

      TimerService.start(timerName, 5000, function() {
        if (!$scope.location) return;

        var properties = {};
        if ($scope.location.accuracy) properties.accuracy = $scope.location.accuracy;
        if ($scope.location.altitude) properties.altitude = $scope.location.altitude;
        if ($scope.location.altitudeAccuracy) properties.altitudeAccuracy = $scope.location.altitudeAccuracy;
        if ($scope.location.heading) properties.heading = $scope.location.heading;
        if ($scope.location.speed) properties.speed = $scope.location.speed;

        var location = new Location({
          location: {
            type: "Feature",
            geometry: {
              type: 'Point',
              coordinates: [$scope.location.longitude, $scope.location.latitude]
            },
            properties: properties
          },
          timestamp: new Date()
        });

        $scope.positionBroadcast = location.$save();

        // LocationService.createLocation(location)
        //   .success(function (data, status, headers, config) {
        //     $scope.positionBroadcast = location;
        //   });
      });
    } else {
      TimerService.stop(timerName);
    }
  }

  $scope.checkCurrentMapPanel = function (mapPanel) {
    return MapService.getCurrentMapPanel() == mapPanel;
  }

  $scope.setCurrentMapPanel = function (mapPanel) {
    if (MapService.getCurrentMapPanel() == mapPanel) {
      MapService.setCurrentMapPanel('none');
    } else {
      MapService.setCurrentMapPanel(mapPanel);
    }
  }

  /* Goto address, need to implement some geocoding like the android app does, otherwise pull it out for PDC. */
  $scope.openGotoAddress = function () {
    console.log("in goto address");
    $scope.showGoToAddress = true;
  }

  $scope.dismissGotoAddress = function () {
    console.log("in goto address");
    $scope.showGoToAddress = false;
  }


  /* Need to sort out how this works with the GeoJSON layers... */
  $scope.refreshPoints = function () {
    // TODO refresh point for selected layers
  //   console.log("in refresh points");
  //   $('#refresh-panel').removeCl***REMOVED***('hide');
  //   $scope.multiMarkers = {};

  //   $http.get(appConstants.rootUrl + '/FeatureServer/' + $scope.currentLayerId + '/query?outFields=OBJECTID').
  //       success(function (data, status, headers, config) {
  //           console.log('got points');
  //           $scope.points = data.features;
  //           var markers = {};
  //           for (var i = 0; i <  $scope.points.length; i++) {
  //             console.log($scope.points[i].geometry.x + ", " + $scope.points[i].geometry.y);
  //             markers[$scope.points[i].attributes.OBJECTID] = {lat: $scope.points[i].geometry.y, lng: $scope.points[i].geometry.x,draggable: false, id: $scope.points[i].attributes.OBJECTID};
  //           }
  //           $scope.multiMarkers = markers;
  //       }).
  //       error(function (data, status, headers, config) {
  //           $log.log("Error getting layers: " + status);
  //       });

  //   $('#refresh-panel').addCl***REMOVED***('hide');
  }

  $scope.dismissRefresh = function () {
    console.log("in refresh points");
    $scope.showRefresh = false;
  }

  $scope.newsFeed = function() {
    if ($scope.newsFeedEnabled) {
      $scope.setCurrentMapPanel('newsFeed');
    }
  }

  /* location ***REMOVED***s is FFT */
  $scope.locationServices = function() {
    var timerName = 'pollLocation';

    if ($scope.locationServicesEnabled || $scope.locationPollTime == 0) {
      TimerService.start(timerName, $scope.locationPollTime || 5000, function() {
        ds.locationsLoaded = false;
        ds.locations = Location.get({/*startTime: $scope.startTime, endTime: $scope.endTime*/}, function(success) {
          ds.locationsLoaded = true;
          $scope.locations = ds.locations;
          console.info('ds', ds);
          _.each($scope.locations, function(userLocation) {
              UserService.getUser(userLocation.user)
                .then(function(user) {
                  userLocation.userModel = user.data || user;
                });
              
            });
        });

      // LocationService.getLocations().
      //   success(function (data, status, headers, config) {
      //     $scope.locations = _.filter(data, function(user) {
      //       return user.locations.length;
      //     });
      //     _.each($scope.locations, function(userLocation) {
      //         UserService.getUser(userLocation.user)
      //           .then(function(user) {
      //             userLocation.userModel = user.data || user;
      //           });
              
      //       });
      //   }).
      //   error(function () {
      //     console.log('error getting locations');
      //   });
      });
    } else {
      $scope.locations = [];
      TimerService.stop(timerName);
    }
  }

  $scope.$watch('locationPollTime', function() {
    if ($scope.locationPollTime) {
      $scope.locationServices();
    }
  });

  $scope.dismissLocations = function() {
    console.log("in dismissLocations");
    $scope.showLocations = false;
  }

  /* Open and close the export dialog, and handle making the call to get the KML file. */
  $scope.openExport = function () {
    console.log("opening export");
    $scope.showExport = true;
  }

  $scope.closeExport = function () {
    console.log("closing export panel");
    $scope.showExport = false;
  }

  /* Export existing points to  */
  $scope.export = function () {
    console.log("exporting features to KML");
     
    //error checking...
    $("#export-error-message").hide();
    if(!$scope.fft_layer && $scope.exportLayers.length == 0) {
      $("#export-error-message").html('Error: Please Select a Layer.');
      $("#export-error-message").show();
      return;
    }

    var url = appConstants.rootUrl + "/api/export" + 
      "?access_token=" + mageLib.getLocalItem('token') +
      "&time_filter=" + $scope.time_filter;
      
    if($scope.fft_layer) {
        url = url + "&fft_layer=" + $scope.fft_layer;
    }

    if($scope.exportLayers.length > 0) {
      var layer_ids = _.map($scope.exportLayers,function(layer){return layer.id}).join();
      url = url + "&export_layers=" + layer_ids;
    }

    window.location.href = url;
  }

  $scope.addExportLayer = function (layer) {
    $scope.exportLayers.push(layer);
  }
}