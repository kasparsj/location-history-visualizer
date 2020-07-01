( function ( $, L, prettySize ) {
		var map;

		// Updates currentStatus field during data loading
		function status( message ) {
			$( '#currentStatus' ).text( message );
		}

		// If browser does not support 'date' inputs, use 
		// jquery-ui's datepicker
		if ( $('[type="date"]').prop('type') != 'date' ) {
			$('[type="date"]').datepicker();
		}
		
		// Start at the beginning
		stageOne();

		function stageOne () {
			var dropzone;

			// Initialize the map
			map = L.map( 'map' ).setView( [0,0], 2 );
			L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: 'location-history-visualizer is open source and available <a href="https://github.com/operte/location-history-visualizer">on GitHub</a>. Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors.',
				maxZoom: 18,
				minZoom: 2
			} ).addTo( map );

			// Initialize the dropzone
			dropzone = new Dropzone( document.body, {
				url: '/',
				previewsContainer: document.createElement( 'div' ), // >> /dev/null
				clickable: false,
				accept: function ( file, done ) {
					stageTwo( file );
					dropzone.disable(); // Your job is done, buddy
				}
			} );

			// For mobile browsers, allow direct file selection as well
			$( '#file' ).change( function () {
				stageTwo( this.files[0], document.getElementById("fromDate").value, document.getElementById("toDate").value );
				dropzone.disable();
			} );
		}

		function stageTwo ( file, fromDate, toDate ) {

			var type;

			try {
				if ( /\.kml$/i.test( file.name ) ) {
					type = 'kml';
				} else {
					type = 'json';
				}
			} catch ( ex ) {
				status( 'Something went wrong generating your map. Ensure you\'re uploading a Google Takeout JSON file that contains location data and try again, or create an issue on GitHub if the problem persists. ( error: ' + ex.message + ' )' );
				return;
			}

			// First, change tabs
			$( 'body' ).addClass( 'working' );
			$( '#intro' ).addClass( 'hidden' );
			$( '#working' ).removeClass( 'hidden' );

			if(fromDate && toDate){
				fromDate=new Date(document.getElementById("fromDate").value).getTime();
				toDate=new Date(document.getElementById("toDate").value).getTime();
			}
			
			var SCALAR_E7 = 0.0000001; // Since Google Takeout stores latlngs as integers
			var latlngs = [];
			var polyline = L.polyline(latlngs, {color: 'red'}).addTo(map);


			// Use Oboe to stream Google Takeout data if file is JSON
			var os = new oboe();
			os.node( 'locations.*', function ( location ) {
				var latitude = location.latitudeE7 * SCALAR_E7,
					longitude = location.longitudeE7 * SCALAR_E7;

				// Handle negative latlngs due to google unsigned/signed integer bug.
				if ( latitude > 180 ) latitude = latitude - (2 ** 32) * SCALAR_E7;
				if ( longitude > 180 ) longitude = longitude - (2 ** 32) * SCALAR_E7;

				if ( type === 'json' ) {
					if(fromDate && toDate){
						if(location.timestampMs > fromDate && location.timestampMs < toDate) 
							latlngs.push( [ latitude, longitude ] );
					} else {
						latlngs.push( [ latitude, longitude ] );
					}
				}
				
				return oboe.drop;
			} ).done( function () {
				status( 'Generating map...' );
				polyline.setLatLngs(latlngs);

				stageThree(  /* numberProcessed */ latlngs.length );
			} );

			var fileSize = prettySize( file.size );

			status( 'Preparing to import file ( ' + fileSize + ' )...' );

			// Now start working!
			if ( type === 'json' ) parseJSONFile( file, os );
			if ( type === 'kml' ) parseKMLFile( file );
		}

		function stageThree ( numberProcessed ) {
			// Change tabs
			$( 'body' ).removeClass( 'working' );
			$( '#working' ).addClass( 'hidden' );
			$( '#done' ).removeClass( 'hidden' );

			// Update count
			$( '#numberProcessed' ).text( numberProcessed.toLocaleString() );

			$( '#launch' ).click( function () {
				$( 'body' ).addClass( 'map-active' );
				$( '#done' ).fadeOut();
			} );


		}

		/*
		Break file into chunks and emit 'data' to oboe instance
		*/

		function parseJSONFile( file, oboeInstance ) {
			var fileSize = file.size;
			var prettyFileSize = prettySize(fileSize);
			var chunkSize = 512 * 1024; // bytes
			var offset = 0;
			var self = this; // we need a reference to the current object
			var chunkReaderBlock = null;
			var startTime = Date.now();
			var endTime = Date.now();
			var readEventHandler = function ( evt ) {
				if ( evt.target.error == null ) {
					offset += evt.target.result.length;
					var chunk = evt.target.result;
					var percentLoaded = ( 100 * offset / fileSize ).toFixed( 0 );
					status( percentLoaded + '% of ' + prettyFileSize + ' loaded...' );
					oboeInstance.emit( 'data', chunk ); // callback for handling read chunk
				} else {
					return;
				}
				if ( offset >= fileSize ) {
					oboeInstance.emit( 'done' );
					return;
				}

				// of to the next chunk
				chunkReaderBlock( offset, chunkSize, file );
			}

			chunkReaderBlock = function ( _offset, length, _file ) {
				var r = new FileReader();
				var blob = _file.slice( _offset, length + _offset );
				r.onload = readEventHandler;
				r.readAsText( blob );
			}

			// now let's start the read with the first block
			chunkReaderBlock( offset, chunkSize, file );
		}

		/*
	        Default behavior for file upload (no chunking)
		*/

		function parseKMLFile( file ) {
			var fileSize = prettySize( file.size );
			var reader = new FileReader();
			reader.onprogress = function ( e ) {
				var percentLoaded = Math.round( ( e.loaded / e.total ) * 100 );
				status( percentLoaded + '% of ' + fileSize + ' loaded...' );
			};

			reader.onload = function ( e ) {
				var latlngs;
				status( 'Generating map...' );
				latlngs = getLocationDataFromKml( e.target.result );
				heat._latlngs = latlngs;
				heat.redraw();
				stageThree( latlngs.length );
			}
			reader.onerror = function () {
				status( 'Something went wrong reading your JSON file. Ensure you\'re uploading a "direct-from-Google" JSON file and try again, or create an issue on GitHub if the problem persists. ( error: ' + reader.error + ' )' );
			}
			reader.readAsText( file );
		}

		function getLocationDataFromKml( data ) {
			var KML_DATA_REGEXP = /<when>( .*? )<\/when>\s*<gx:coord>( \S* )\s( \S* )\s( \S* )<\/gx:coord>/g,
				locations = [],
				match = KML_DATA_REGEXP.exec( data );

			// match
			//  [ 1 ] ISO 8601 timestamp
			//  [ 2 ] longitude
			//  [ 3 ] latitude
			//  [ 4 ] altitude ( not currently provided by Location History )
			while ( match !== null ) {
				locations.push( [ Number( match[ 3 ] ), Number( match[ 2 ] ) ] );
				match = KML_DATA_REGEXP.exec( data );
			}

			return locations;
		}

}( jQuery, L, prettySize ) );
