(function ($, L, prettySize) {
    var SCALAR_E7 = 0.0000001; // Since Google Takeout stores latlngs as integers
    var RADIUS = 6371;
    var ROUNDING = 0.5;
    var PLAY_UPDATE = 1000/60;
    var TILES_URL = location.protocol === "file:" ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' : 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png';
    var map;
    var tileLayer;
    var points;
    var pointsData;
    var locations = {};
    var locData;
	var connections = {};
	var lines;
	var linesData;
	var minTs, maxTs;
	var playInterval;
	var playPoints = [];
	var playTimes = [];
	var isPlaying = false;
    var playSpeed = localStorage.getItem("playSpeed") || 1000;
    var trailLength = localStorage.getItem("trailLength") || 12;
    var minSize = localStorage.getItem("minSize") || 3;
    var maxSize = localStorage.getItem("maxSize") || 20;
    var divider = localStorage.getItem("divider") || 10;
    var showPoints = localStorage.getItem("showPoints") === null ? true : localStorage.getItem("showPoints") === "true";
    var showLines = localStorage.getItem("showLines") === null ? true : localStorage.getItem("showLines") === "true";
    var excludeDriving = localStorage.getItem("excludeDriving") === null ? true : localStorage.getItem("excludeDriving") === "true";
    var currentMs;
    var isNightTime = false;

    $("#playSpeed").val(playSpeed);
    $("#trailLength").val(trailLength);
    $("#minSize").val(minSize);
    $("#maxSize").val(maxSize);
    $("#divider").val(divider);
    $("#showPoints")[0].checked = showPoints;
    $("#showLines")[0].checked = showLines;
    $("#excludeDriving")[0].checked = excludeDriving;


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
        tileLayer = L.tileLayer(TILES_URL, {
            maxZoom: 18,
            minZoom: 2,
            zoomSnap: 0.5,
            attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
        });
        tileLayer.addTo(map);

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
				prevLocation.next = location;
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
                    var times = locData[point.toString()] ? locData[point.toString()][0].times : 0;
                    return Math.max(Math.min(times / divider, maxSize), minSize);
                },
                // color: (i, point) => {
                //     if (isPlaying && i === points.settings.data.length-1) {
                //         return {r: 0.66, g: 0, b: isNightTime ? 0.08 : 0, a: 1};
                //     }
                //     return {
                //         r: 0.66,
                //         g: 0,
                //         b: isNightTime ? 0.08 : 0,
                //         a: isPlaying ? 1-(currentMs - playTimes[i]) / (trailLength*60*60*1000) : 1
                //     };
                // },
                click: (e, point) => {
                    if (!locData[point.toString()]) return;
                    var location = locData[point.toString()][0];
                    var dataPoints = locData[point.toString()].length;
                    //set up a standalone popup (use a popup as a layer)
                    L.popup()
                        .setLatLng(point)
                        .setContent('First time visited on:' + (new Date(parseInt(location.timestampMs))).toString() + '. Accuracy: ' + location.accuracy + '. Times: ' + location.times + ' / ' + dataPoints)
                        .openOn(map);
                },
                data: showPoints ? pointsData : []
            });

            lines = L.glify.lines({
            	map: map,
            	latitudeKey: 0,
            	longitudeKey: 1,
            	weight: 10,
                // color: (i, feature) => {
                //     if (isPlaying && i === lines.settings.data.features.length-1) {
                //         return {r: 0.66, g: 0, b: isNightTime ? 0.08 : 0, a: 1};
                //     }
                //     return {
                //         r: 0.66,
                //         g: 0,
                //         b: isNightTime ? 0.08 : 0,
                //         a: isPlaying ? 1-(currentMs - playTimes[i]) / (trailLength*60*60*1000) : 1
                //     };
                // },
            	click: (e, feature) => {
            		L.popup()
            			.setLatLng(e.latlng)
            			.setContent('You clicked on ' + feature.properties.name)
            			.openOn(map);
            	},
            	data: {
					type: "FeatureCollection",
					features: showLines ? linesData : []
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
        $('#play').click(onPlay);
        $('#stop').click(onStop);
        $('#minSize').change(function() {
            minSize = parseInt($('#minSize').val()) || minSize;
            localStorage.setItem("minSize", minSize);
            if (!isPlaying) {
                renderPoints();
            }
        });
        $('#maxSize').change(function() {
            maxSize = parseInt($('#maxSize').val()) || maxSize;
            localStorage.setItem("maxSize", maxSize);
            if (!isPlaying) {
                renderPoints();
            }
        });
        $('#divider').change(function() {
            divider = parseInt($('#divider').val()) || divider;
            localStorage.setItem("divider", divider);
            if (!isPlaying) {
                renderPoints();
            }
        });
        $('#trailLength').change(function() {
            trailLength = Math.abs(parseInt($("#trailLength").val())) || trailLength;
            localStorage.setItem("trailLength", trailLength);
        });
        $('#playSpeed').change(function() {
            playSpeed = (parseInt($("#playSpeed").val()) || playSpeed);
            localStorage.setItem("playSpeed", playSpeed);
        });
        $('#showPoints').change(function() {
            showPoints = $("#showPoints").is(":checked");
            localStorage.setItem("showPoints", showPoints);
        });
        $('#showLines').change(function() {
            showLines = $("#showLines").is(":checked");
            localStorage.setItem("showLines", showLines);
        });
        $('#excludeDriving').change(function() {
            excludeDriving = $("#excludeDriving").is(":checked");
            localStorage.setItem("excludeDriving", excludeDriving);
        });
    }

	function toggleMap() {
		$('.leaflet-tile-pane').css("visibility", $('#showMap').is(':checked') ? 'visible' : 'hidden');
	}

	function renderPoints(data) {
		points.settings.data = showPoints ? data || pointsData : [];
		points.render();
	}

    function renderLines(data) {
		lines.settings.data.features = showLines ? data || linesData : [];
		lines.render();
	}

    function onUpdate() {
        if (isPlaying) {
            onStop();
        }
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

	function onPlay() {
        isPlaying = true;
        $("#play").hide();
        $("#stop").show();
        var currentLoc = locData[pointsData[0].toString()][0];
        playFrame(currentLoc, 0);
    }

    function playFrame(currentLoc, time) {
        var nextLoc = getNextPoint(currentLoc);
        renderPoint(currentLoc, nextLoc, time);
        if (!nextLoc) {
            onStop();
            return;
        }
        var ms = Math.max(0, Math.min(PLAY_UPDATE, (nextLoc.timestampMs - currentLoc.timestampMs) / (1000*60*60*24) * Math.max(1, playSpeed)));
        playInterval = setTimeout(function() {
            if ((time + ms) >= (nextLoc.timestampMs - currentLoc.timestampMs) / (1000*60*60*24) * Math.max(1, playSpeed)) {
                playFrame(nextLoc, 0);
            }
            else {
                playFrame(currentLoc, time + ms);
            }
        }, ms);
    }

    function renderPoint(currentLoc, nextLoc, time) {
        var diff = (nextLoc.timestampMs - currentLoc.timestampMs);
        var progress = time / (diff / (1000*60*60*24) * Math.max(1, playSpeed));
        currentMs = currentLoc.timestampMs + diff * progress;
        var between = lerpLatLon(currentLoc.point, nextLoc.point, progress);
        if (!playPoints.length || between[0] !== playPoints[0][0] || between[1] !== playPoints[0][1]) {
            playPoints.push(between);
            playTimes.push(currentMs);
        }
        while (playTimes.length > 1 && playTimes[0] < currentMs - trailLength*60*60*1000) {
            playPoints.shift();
            playTimes.shift();
        }
        var currentTZ = tzlookup(playPoints[playPoints.length-1][0], playPoints[playPoints.length-1][1]);
        updateClock(currentMs, currentTZ);
        renderPoints(playPoints);
        if (showLines) {
            var playLines = [{
                type: "Feature",
                properties: {
                    scalerank: 2,
                    name: "todo: should be times",
                    name_alt: null,
                    featureclass: "Connection"
                },
                geometry: {
                    type: "LineString",
                    coordinates: playPoints
                }
            }];
            renderLines(playLines);
        }
        map.fitBounds(playPoints, {padding: [100, 100], maxZoom: 14});
    }

    function updateClock(ms, tz) {
        var date = new Date(ms);
        var tzDate = new Date(date.toLocaleString("en-US", {timeZone: tz}));
        clock(tzDate);
        $("#currentDate").text(tzDate.toLocaleString());
        $("#timezone").text(tz);
        isNightTime = tzDate.getHours() > 20 || tzDate.getHours() < 6;
        $(".visualizer").toggleClass("dark-mode", isNightTime);
    }

    function getNextPoint(currentLoc) {
        var nextLoc = currentLoc.next;
        while (nextLoc && !nextLoc.point) {
            nextLoc = nextLoc.next;
        }
        return nextLoc;
    }

    function onStop() {
        isPlaying = false;
        $("#stop").hide();
        $("#play").show();
        clearInterval(playInterval);
        $(".visualizer").removeClass("dark-mode");
        onUpdate();
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
        $("#totalPoints").text(pointsData.length);
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

    function lerpLatLon(point1, point2, fraction) {
        if (fraction <= 0) return point1;
        if (fraction >= 1) return point2;
        if (point1[0] === point2[0] && point1[1] === point2[1]) {
            return point1;
        }

        var lat1Rad = point1[0] * (Math.PI / 180);
        var lon1Rad = point1[1] * (Math.PI / 180);
        var lat2Rad = point2[0] * (Math.PI / 180);
        var lon2Rad = point2[1] * (Math.PI / 180);

        // distance between points
        const deltaLat = lat2Rad - lat1Rad;
        const deltaLon = lon2Rad - lon1Rad;
        const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
        const g = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const A = Math.sin((1-fraction)*g) / Math.sin(g);
        const B = Math.sin(fraction*g) / Math.sin(g);

        const x = A * Math.cos(lat1Rad) * Math.cos(lon1Rad) + B * Math.cos(lat2Rad) * Math.cos(lon2Rad);
        const y = A * Math.cos(lat1Rad) * Math.sin(lon1Rad) + B * Math.cos(lat2Rad) * Math.sin(lon2Rad);
        const z = A * Math.sin(lat1Rad) + B * Math.sin(lat2Rad);

        const lat3Rad = Math.atan2(z, Math.sqrt(x*x + y*y));
        const lon3Rad = Math.atan2(y, x);

        const lat = lat3Rad * 180 / Math.PI;
        const lon = lon3Rad * 180 / Math.PI;

        return [lat, lon];
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

const secondSelector = document.querySelector('.seconds');
const minuteSelector = document.querySelector('.minutes');
const hourSelector = document.querySelector('.hours');

function clock(now) {
    const seconds = now.getSeconds();
    const minutes = now.getMinutes();
    const hours = now.getHours();

    const getSecondsDegrees = ((seconds / 60) * 360);
    const getMinutesDegrees = ((minutes / 60) * 360);
    const getHoursDegrees = ((hours / 12) * 360);

    secondSelector.style.transform = `rotate(${getSecondsDegrees}deg)`;
    minuteSelector.style.transform = `rotate(${getMinutesDegrees}deg)`;
    hourSelector.style.transform = `rotate(${getHoursDegrees}deg)`;
}
