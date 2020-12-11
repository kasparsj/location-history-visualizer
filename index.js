(function ($, L, prettySize) {
    var SCALAR_E7 = 0.0000001; // Since Google Takeout stores latlngs as integers
    var RADIUS = 6371;
    var ROUNDING = 0.5;
    var map;
    var points;
    var pointsData;
    var locations = {};
    var locData;
	var connections = {};
	var lines;
	var linesData;
	var minTs, maxTs;

    // Updates currentStatus field during data loading
    function status(message) {
        $('#currentStatus').text(message);
    }

    // If browser does not support 'date' inputs, use
    // jquery-ui's datepicker
    if ($('[type="date"]').prop('type') != 'date') {
        $('[type="date"]').datepicker();
    }

    // Start at the beginning
    stageOne();

    function stageOne() {
        var dropzone;

        // Initialize the map
        map = L.map('map').setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'location-history-visualizer is open source and available <a href="https://github.com/operte/location-history-visualizer">on GitHub</a>. Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors.',
            maxZoom: 18,
            minZoom: 2
        }).addTo(map);

        // Initialize the dropzone
        dropzone = new Dropzone(document.body, {
            url: '/',
            previewsContainer: document.createElement('div'), // >> /dev/null
            clickable: false,
            accept: function (file, done) {
                stageTwo(file);
                dropzone.disable(); // Your job is done, buddy
            }
        });

        // For mobile browsers, allow direct file selection as well
        $('#file').change(function () {
            stageTwo(this.files[0]);
            dropzone.disable();
        });
    }

    function stageTwo(file) {

        var type;

        try {
            if (/\.kml$/i.test(file.name)) {
                type = 'kml';
            } else {
                type = 'json';
            }
        } catch (ex) {
            status('Something went wrong generating your map. Ensure you\'re uploading a Google Takeout JSON file that contains location data and try again, or create an issue on GitHub if the problem persists. ( error: ' + ex.message + ' )');
            return;
        }

        // First, change tabs
        $('body').addClass('working');
        $('#intro').addClass('hidden');
        $('#working').removeClass('hidden');

        var prevLocation;

        // Use Oboe to stream Google Takeout data if file is JSON
        var os = new oboe();
        os.node('locations.*', function (location) {
            location.lat = location.latitudeE7 * SCALAR_E7;
            location.lon = location.longitudeE7 * SCALAR_E7;

            // Handle negative latlngs due to google unsigned/signed integer bug.
            if (location.lat > 180) location.lat = location.lat - (2 ** 32) * SCALAR_E7;
            if (location.lon > 180) location.lon = location.lon - (2 ** 32) * SCALAR_E7;

            location.timestampMs = parseInt(location.timestampMs);

            calcRounded(location);

			if (prevLocation) {
				location.prev = prevLocation;
			}
			prevLocation = location;

            return oboe.drop;
        }).done(function () {
            status('Generating map...');

            filterLocations();
            collectConnections();

            points = L.glify.points({
                map,
                size: (i, point) => {
                    var times = locData[point.toString()][0].times;
                    var minSize = parseInt($('#minSize').val()) || 3;
                    var maxSize = parseInt($('#maxSize').val()) || 20;
                    var divider = parseInt($('#divider').val()) || 10;
                    return Math.max(Math.min(times / divider, maxSize), minSize);
                },
                color: (i, point) => {
                    return {
                        r: 1,
                        g: 0,
                        b: 0,
                    };
                },
                click: (e, point) => {
                    var location = locData[point.toString()][0];
                    var dataPoints = locData[point.toString()].length;
                    //set up a standalone popup (use a popup as a layer)
                    L.popup()
                        .setLatLng(point)
                        .setContent('First time visited on:' + (new Date(parseInt(location.timestampMs))).toString() + '. Accuracy: ' + location.accuracy + '. Times: ' + location.times + ' / ' + dataPoints)
                        .openOn(map);
                },
                data: pointsData
            });

            lines = L.glify.lines({
            	map: map,
            	latitudeKey: 0,
            	longitudeKey: 1,
            	weight: 5,
            	click: (e, feature) => {
            		L.popup()
            			.setLatLng(e.latlng)
            			.setContent('You clicked on ' + feature.properties.name)
            			.openOn(map);
            	},
            	data: {
					type: "FeatureCollection",
					features: linesData
				}
            });

            stageThree( pointsData.length);
        });

        var fileSize = prettySize(file.size);

        status('Preparing to import file ( ' + fileSize + ' )...');

        // Now start working!
        if (type === 'json') parseJSONFile(file, os);
        if (type === 'kml') parseKMLFile(file);
    }

    function stageThree(numberProcessed) {
        // Change tabs
        $('body').removeClass('working');
        $('#working').addClass('hidden');
        $('#done').removeClass('hidden');

        // Update count
        $('#numberProcessed').text(numberProcessed.toLocaleString());

        $('#launch').click(function () {
            $('body').addClass('map-active');
            $('#done').fadeOut();
        });

        $('#showMap').change(toggleMap);
		$('#showPoints').change(renderPoints);
		$('#showLines').change(renderLines);
        $('#update').click(onUpdate);
    }

	function toggleMap() {
		$('.leaflet-tile-pane').css("visibility", $('#showMap').is(':checked') ? 'visible' : 'hidden');
	}

	function renderPoints() {
		points.settings.data = $('#showPoints').is(':checked') ? pointsData : [];
		points.render();
	}

    function renderLines() {
		lines.settings.data.features = $('#showLines').is(':checked') ? linesData : [];
		lines.render();
	}

    function onUpdate() {
		$('body').addClass('working');
		var rounding = parseFloat($('#rounding').val());
		if (!isNaN(rounding) && rounding !== ROUNDING) {
			ROUNDING = rounding;
			updateLocations();
		}
		filterLocations();
		renderPoints();
		collectConnections();
		renderLines();
		$('body').removeClass('working');
	}

    function calcRounded(location) {
        location.cartesian = calcCartesianCoord(location.lat, location.lon, RADIUS / ROUNDING);
        var roundedCartesian = location.cartesian.map(function (x) {
            return Math.round(x);
        });
        var roundedLatLon = calcLatLon(roundedCartesian, RADIUS / ROUNDING);
        location.roundedLatLon = roundedLatLon;
        if (!locations[roundedLatLon.toString()]) {
            locations[roundedLatLon.toString()] = [location];
        } else {
            locations[roundedLatLon.toString()].push(location);
        }
    }

    function calcTimes(locs) {
        var times = 0;
        for (var i=1; i<locs.length; i++) {
            if (locs[i].timestampMs > (locs[(i-1)].timestampMs + 1000*60*60*4)) {
                times++;
            }
        }
        return times;
    }

    function isDriving(loc) {
        if (loc.activity) {
            for (var i=0; i<loc.activity[0].activity.length; i++) {
                if (loc.activity[0].activity[i].type === "IN_VEHICLE" && loc.activity[0].activity[i].confidence >= 10) {
                    return true;
                }
            }
        }
        return false;
    }

    function updateLocations() {
        var locations2 = locations;
        locations = {};
        for (var p2 in locations2) {
            var locs2 = locations2[p2];
            for (var i = 0; i < locs2.length; i++) {
                calcRounded(locs2[i]);
            }
        }
    }

    function filterLocations() {
        locData = {};
        pointsData = [];
        var fromDate = new Date($("#fromDate").val()).getTime();
        var toDate = new Date($("#toDate").val()).getTime();
        var maxAccuracy = parseInt($("#maxAccuracy").val());
        var minData = parseInt($('#minData').val()) || 1;
        var minTimes = parseInt($('#minTimes').val()) || 1;
        var excludeDriving = $('#excludeDriving').is(':checked');
        for (var p in locations) {
            var locs = locations[p].filter(function (loc) {
            	// quickfix
            	delete loc.point;
                return (!maxAccuracy || loc.accuracy <= maxAccuracy) &&
                    (!fromDate || loc.timestampMs >= fromDate) &&
                    (!toDate || loc.timestampMs <= toDate) &&
                    (!excludeDriving || !isDriving(loc));
            });
            var times = calcTimes(locs);
            if (locs.length < minData || times < minTimes) {
                continue;
            }
			var point;
            if (locs.length === 1) {
                point = [locs[0].lat, locs[0].lon];
            } else {
                point = avarageLatLon(locs);
            }
			locs.map(function(loc) {
			    loc.point = point;
                loc.times = times;
                if (!minTs || loc.timestampMs < minTs) {
                    minTs = loc.timestampMs;
                }
                if (!maxTs || loc.timestampMs > maxTs) {
                    maxTs = loc.timestampMs;
                }
			});
			locData[point.toString()] = locs;
			pointsData.push(point);
		}
    }

    function collectConnections() {
    	connections = {};
    	linesData = [];
    	for (var p in locData) {
			connections[p] = [];
    		for (var i=0; i<locData[p].length; i++) {
    			var prev = locData[p][i].prev;
    			while (prev && !prev.point) {
					prev = prev.prev;
				}
				if (prev && prev.point && connections[p].indexOf(prev.point) === -1) {
					connections[p].push(prev.point);
					var line = {
						type: "Feature",
						properties: {
							scalerank: 2,
							name: "todo: should be times",
							name_alt: null,
							featureclass: "Connection"
						},
						geometry: {
							type: "LineString",
							coordinates: [locData[p][0].point.slice(), prev.point.slice()]
						}
					};
					linesData.push(line);
				}
			}
		}
	}

    function avarageLatLon(locs) {
        var sum = [0, 0, 0];
        for (var i = 0; i < locs.length; i++) {
            var loc = locs[i];
            sum[0] += loc.cartesian[0];
            sum[1] += loc.cartesian[1];
            sum[2] += loc.cartesian[2];
        }
        var avg = [sum[0] / locs.length, sum[1] / locs.length, sum[2] / locs.length];
        return calcLatLon(avg, RADIUS / ROUNDING);
    }

    function calcCartesianCoord(lat, lon, radius) {
        var latRad = lat * (Math.PI / 180);
        var lonRad = lon * (Math.PI / 180);
        var x = radius * Math.cos(latRad) * Math.cos(lonRad);
        var y = radius * Math.cos(latRad) * Math.sin(lonRad);
        var z = radius * Math.sin(latRad);
        return [x, y, z];
    }

    function calcLatLon(coord, radius) {
        var x = coord[0];
        var y = coord[1];
        var z = coord[2];
        var lat = Math.asin(z / radius) * (180 / Math.PI);
        var lon = Math.atan2(y, x) * (180 / Math.PI);
        return [lat, lon];
    }

    /*
    Break file into chunks and emit 'data' to oboe instance
    */

    function parseJSONFile(file, oboeInstance) {
        var fileSize = file.size;
        var prettyFileSize = prettySize(fileSize);
        var chunkSize = 512 * 1024; // bytes
        var offset = 0;
        var chunkReaderBlock = null;
        var readEventHandler = function (evt) {
            if (evt.target.error == null) {
                offset += evt.target.result.length;
                var chunk = evt.target.result;
                var percentLoaded = (100 * offset / fileSize).toFixed(0);
                status(percentLoaded + '% of ' + prettyFileSize + ' loaded...');
                oboeInstance.emit('data', chunk); // callback for handling read chunk
            } else {
                return;
            }
            if (offset >= fileSize) {
                oboeInstance.emit('done');
                return;
            }

            // of to the next chunk
            chunkReaderBlock(offset, chunkSize, file);
        }

        chunkReaderBlock = function (_offset, length, _file) {
            var r = new FileReader();
            var blob = _file.slice(_offset, length + _offset);
            r.onload = readEventHandler;
            r.readAsText(blob);
        }

        // now let's start the read with the first block
        chunkReaderBlock(offset, chunkSize, file);
    }

    /*
        Default behavior for file upload (no chunking)
    */

    function parseKMLFile(file) {
        var fileSize = prettySize(file.size);
        var reader = new FileReader();
        reader.onprogress = function (e) {
            var percentLoaded = Math.round((e.loaded / e.total) * 100);
            status(percentLoaded + '% of ' + fileSize + ' loaded...');
        };

        reader.onload = function (e) {
            var latlngs;
            status('Generating map...');
            latlngs = getLocationDataFromKml(e.target.result);
            heat._latlngs = latlngs;
            heat.redraw();
            stageThree(latlngs.length);
        }
        reader.onerror = function () {
            status('Something went wrong reading your JSON file. Ensure you\'re uploading a "direct-from-Google" JSON file and try again, or create an issue on GitHub if the problem persists. ( error: ' + reader.error + ' )');
        }
        reader.readAsText(file);
    }

    function getLocationDataFromKml(data) {
        var KML_DATA_REGEXP = /<when>( .*? )<\/when>\s*<gx:coord>( \S* )\s( \S* )\s( \S* )<\/gx:coord>/g,
            locations = [],
            match = KML_DATA_REGEXP.exec(data);

        // match
        //  [ 1 ] ISO 8601 timestamp
        //  [ 2 ] longitude
        //  [ 3 ] latitude
        //  [ 4 ] altitude ( not currently provided by Location History )
        while (match !== null) {
            locations.push([Number(match[3]), Number(match[2])]);
            match = KML_DATA_REGEXP.exec(data);
        }

        return locations;
    }

}(jQuery, L, prettySize));
