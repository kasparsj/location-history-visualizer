// Set of functions to analyse location data

// LatLon: parse and operate on Latitude/Longitude coordinates
import LatLon from 'https://cdn.jsdelivr.net/npm/geodesy@2.2.1/latlon-spherical.min.js';

export function data_analysis(locData){

    // Zip latitude and longitude
    locData.LatLon = locData.latitude.map( (e,idx) => LatLon.parse(e, locData.longitude[idx]));
    console.log(locData.LatLon[0]);

    //locData.distance = locData.longitude.map((e,i) => locData.latitude);

    var plotlyTester = document.getElementById('plotlyTester');
    plotlyTester.classList.remove('hidden');
	Plotly.newPlot( plotlyTester, [{
        x: locData.timestamp.slice(0,1000),
        y: locData.longitude.slice(0,1000) }], {
        margin: { t: 0 } } 
    );
}