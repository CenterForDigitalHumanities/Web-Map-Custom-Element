import { TILE_SIZE } from '../utils/Constants';

export var QueryHandler = L.Handler.extend({
    addHooks: function() {
        // get a reference to the actual <map> element, so we can 
        // use its layers property to iterate the layers from top down
        // evaluating if they are 'on the map' (enabled)
        L.setOptions(this, {mapEl: this._map.options.mapEl});
        L.DomEvent.on(this._map, 'click', this._queryTopLayer, this);
        L.DomEvent.on(this._map, 'keypress', this._queryTopLayerAtMapCenter, this);
    },
    removeHooks: function() {
        L.DomEvent.off(this._map, 'click', this._queryTopLayer, this);
        L.DomEvent.on(this._map, 'keypress', this._queryTopLayerAtMapCenter, this);
    },
    _getTopQueryableLayer: function() {
        var layers = this.options.mapEl.layers;
        // work backwards in document order (top down)
        for (var l=layers.length-1;l>=0;l--) {
          var mapmlLayer = layers[l]._layer;
          if (layers[l].checked && mapmlLayer.queryable) {
              return mapmlLayer;
          }
        }
    },
    _queryTopLayerAtMapCenter: function (event) {
        if (event.originalEvent.key === " ") {
          this._map.fire('click', { 
              latlng: this._map.getCenter(),
              layerPoint: this._map.latLngToLayerPoint(this._map.getCenter()),
              containerPoint: this._map.latLngToContainerPoint(this._map.getCenter())
          });
        }
    },
    _queryTopLayer: function(event) {
        var layer = this._getTopQueryableLayer();
        if (layer) {
            this._query(event, layer);
        }
    },
    _query(e, layer) {
      var obj = {},
          template = layer.getQueryTemplates()[0],
          zoom = e.target.getZoom(),
          map = this._map,
          crs = layer.crs,
          container = layer._container,
          popupOptions = {autoPan: true, maxHeight: (map.getSize().y * 0.5) - 50},
          tcrs2pcrs = function (c) {
            return crs.transformation.untransform(c,crs.scale(zoom));
          },
          tcrs2gcrs = function (c) {
            return crs.unproject(crs.transformation.untransform(c,crs.scale(zoom)),zoom);
          };
      var tcrsClickLoc = crs.latLngToPoint(e.latlng, zoom),
          tileMatrixClickLoc = tcrsClickLoc.divideBy(TILE_SIZE).floor(),
          tileBounds = new L.Bounds(tcrsClickLoc.divideBy(TILE_SIZE).floor().multiplyBy(TILE_SIZE), 
          tcrsClickLoc.divideBy(TILE_SIZE).ceil().multiplyBy(TILE_SIZE));
  
      // all of the following are locations that might be used in a query, I think.
      obj[template.query.tilei] = tcrsClickLoc.x.toFixed() - (tileMatrixClickLoc.x * TILE_SIZE);
      obj[template.query.tilej] = tcrsClickLoc.y.toFixed() - (tileMatrixClickLoc.y * TILE_SIZE);
      
      // this forces the click to the centre of the map extent in the layer crs
      obj[template.query.mapi] = (map.getSize().divideBy(2)).x.toFixed();
      obj[template.query.mapj] = (map.getSize().divideBy(2)).y.toFixed();
      
      obj[template.query.pixelleft] = crs.pointToLatLng(tcrsClickLoc, zoom).lng;
      obj[template.query.pixeltop] = crs.pointToLatLng(tcrsClickLoc, zoom).lat;
      obj[template.query.pixelright] = crs.pointToLatLng(tcrsClickLoc.add([1,1]), zoom).lng;
      obj[template.query.pixelbottom] = crs.pointToLatLng(tcrsClickLoc.add([1,1]), zoom).lat;
      
      obj[template.query.column] = tileMatrixClickLoc.x;
      obj[template.query.row] = tileMatrixClickLoc.y;
      obj[template.query.x] = tcrsClickLoc.x.toFixed();
      obj[template.query.y] = tcrsClickLoc.y.toFixed();
      
      // whereas the layerPoint is calculated relative to the origin plus / minus any
      // pan movements so is equal to containerPoint at first before any pans, but
      // changes as the map pans. 
      obj[template.query.easting] =  tcrs2pcrs(tcrsClickLoc).x;
      obj[template.query.northing] = tcrs2pcrs(tcrsClickLoc).y;
      obj[template.query.longitude] =  tcrs2gcrs(tcrsClickLoc).lng;
      obj[template.query.latitude] = tcrs2gcrs(tcrsClickLoc).lat;
      obj[template.query.zoom] = zoom;
      obj[template.query.width] = map.getSize().x;
      obj[template.query.height] = map.getSize().y;
      // assumes the click is at the centre of the map, per template.query.mapi, mapj above
      obj[template.query.mapbottom] = tcrs2pcrs(tcrsClickLoc.add(map.getSize().divideBy(2))).y;
      obj[template.query.mapleft] = tcrs2pcrs(tcrsClickLoc.subtract(map.getSize().divideBy(2))).x;
      obj[template.query.maptop] = tcrs2pcrs(tcrsClickLoc.subtract(map.getSize().divideBy(2))).y;
      obj[template.query.mapright] = tcrs2pcrs(tcrsClickLoc.add(map.getSize().divideBy(2))).x;
      
      obj[template.query.tilebottom] = tcrs2pcrs(tileBounds.max).y;
      obj[template.query.tileleft] = tcrs2pcrs(tileBounds.min).x;
      obj[template.query.tiletop] = tcrs2pcrs(tileBounds.min).y;
      obj[template.query.tileright] = tcrs2pcrs(tileBounds.max).x;
      // add hidden or other variables that may be present into the values to
      // be processed by L.Util.template below.
      for (var v in template.query) {
          if (["mapi","mapj","tilei","tilej","row","col","x","y","easting","northing","longitude","latitude","width","height","zoom","mapleft","mapright",",maptop","mapbottom","tileleft","tileright","tiletop","tilebottom","pixeltop","pixelbottom","pixelleft","pixelright"].indexOf(v) < 0) {
              obj[v] = template.query[v];
          }
      }
      fetch(L.Util.template(template.template, obj),{redirect: 'follow'}).then(
          function(response) {
            if (response.status >= 200 && response.status < 300) {
              return Promise.resolve(response);
            } else {
              console.log('Looks like there was a problem. Status Code: ' + response.status);
              return Promise.reject(response);
            }
          }).then(function(response) {
            var contenttype = response.headers.get("Content-Type");
            if ( contenttype.startsWith("text/mapml")) {
              return handleMapMLResponse(response, e.latlng);
            } else {
              return handleOtherResponse(response, layer, e.latlng);
            }
          }).catch(function(err) {
            // no op
          });
      function handleMapMLResponse(response, loc) {
          return response.text().then(mapml => {
              // bind the deprojection function of the layer's crs 
              var _unproject = L.bind(crs.unproject, crs);
              function _coordsToLatLng(coords) {
                  return _unproject(L.point(coords));
              }
              var parser = new DOMParser(),
                  mapmldoc = parser.parseFromString(mapml, "application/xml"),
                  f = M.mapMlFeatures(mapmldoc, {
                  // pass the vector layer a renderer of its own, otherwise leaflet
                  // puts everything into the overlayPane
                  renderer: L.svg(),
                  // pass the vector layer the container for the parent into which
                  // it will append its own container for rendering into
                  pane: container,
                  color: 'yellow',
                  // instead of unprojecting and then projecting and scaling,
                  // a much smarter approach would be to scale at the current
                  // zoom
                  coordsToLatLng: _coordsToLatLng,
                  imagePath: M.detectImagePath(map.getContainer())
              });
              f.addTo(map);

              var c = document.createElement('iframe');
              c.csp = "script-src 'none'";
              c.style = "border: none";
              c.srcdoc = mapmldoc.querySelector('feature properties').innerHTML;

              // passing a latlng to the popup is necessary for when there is no
              // geometry / null geometry
              layer.bindPopup(c, popupOptions).openPopup(loc);
              layer.on('popupclose', function() {
                  map.removeLayer(f);
              });
          });
      }
      function handleOtherResponse(response, layer, loc) {
          return response.text().then(text => {
              var c = document.createElement('iframe');
              c.csp = "script-src 'none'";
              c.style = "border: none";
              c.srcdoc = text;
              layer.bindPopup(c, popupOptions).openPopup(loc);
          });
      }
    }
});