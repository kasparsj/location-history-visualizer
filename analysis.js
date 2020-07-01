// Set of functions to analyse location data

// LatLon: parse and operate on Latitude/Longitude coordinates
import LatLon from 'https://cdn.jsdelivr.net/npm/geodesy@2.2.1/latlon-spherical.min.js';

export function data_analysis(locData){

    // Parse data with LatLon
    locData.LatLon = locData.latitude.map( (itm,idx) => LatLon.parse(itm, locData.longitude[idx]));

    locData.distance = locData.LatLon.reduce((distance, itm, idx, arr) => {
        if (idx === 0) { distance.push(0); }
        else { distance.push(arr[idx-1].distanceTo(itm)); }
        return distance;
    }, []);

    var plotlyTester = document.getElementById('plotlyTester');
    plotlyTester.classList.remove('hidden');
	Plotly.newPlot( plotlyTester, [{
        x: locData.timestamp.slice(0,1000),
        y: locData.distance.slice(0,1000) }], {
        margin: { t: 0 } } 
    );
}