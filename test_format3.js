import { formatEgeInf1RoadGraphHtml } from './frontend/src/utils/formatEgeInf1TaskHtml.js';

const html = `<table>
<tbody><tr><td> <p>На рисунке справа схема дорог Н-ского района изображена в виде графа, в таблице содержатся сведения о протяжённости каждой из этих дорог (в километрах).</p>
<table>
<tbody>
<tr>
<td>
<table>
<tbody>
<tr><td> </td><td>
<p>П1</p></td><td>
<p>П2</p></td><td>
<p>П3</p></td><td>
<p>П4</p></td><td>
<p>П5</p></td><td>
<p>П6</p></td><td>
<p>П7</p></td></tr>
<tr><td>
<p>П1</p></td><td> </td><td>
<p>6</p></td><td>
<p>7</p></td><td>
<p>5</p></td><td> </td><td> </td><td>
<p>3</p></td></tr>
<tr><td>
<p>П2</p></td><td>
<p>6</p></td><td> </td><td> </td><td> </td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П3</p></td><td>
<p>7</p></td><td> </td><td> </td><td>
<p>11</p></td><td> </td><td> </td><td>
<p>12</p></td></tr>
<tr><td>
<p>П4</p></td><td>
<p>5</p></td><td> </td><td>
<p>11</p></td><td> </td><td>
<p>2</p></td><td>
<p>4</p></td><td> </td></tr>
<tr><td>
<p>П5</p></td><td> </td><td> </td><td> </td><td>
<p>2</p></td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П6</p></td><td> </td><td> </td><td> </td><td>
<p>4</p></td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П7</p></td><td>
<p>3</p></td><td> </td><td>
<p>12</p></td><td> </td><td> </td><td> </td><td> </td></tr></tbody></table>
</td>
<td>
<p><img alt="" src="/media/task_files/xs3qstsrc2912DC64661F92C648815E587AE04980_1_1486124738_ce1ddfcc801c.png"/></p></td></tr></tbody></table>
<p>Так как таблицу и схему рисовали независимо друг от друга, то нумерация населённых пунктов в таблице никак не связана с буквенными обозначениями на графе. Определите, какова протяжённость дороги из пункта К в пункт Г. В ответе запишите целое число <!--?import namespace = m urn = "http://www.w3.org/1998/Math/MathML" implementation = "#MathPlayer" declareNamespace /-->\\(–\\) так, как оно указано <br/>в таблице.</p></td></tr>
<tr><td>
</td></tr></tbody></table>`;

// Need to mock DOMParser and document for node
import { JSDOM } from 'jsdom';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const formatted = formatEgeInf1RoadGraphHtml(html);
console.log(formatted);
