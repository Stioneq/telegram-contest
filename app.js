const Utils = (function Utils() {
    /**
     * Find min and max for given chart model
     * @param chartModel
     * @param valueSelector
     * @returns {*}
     */
    function createOffscreenCanvas(width, height) {
        if (window.OffscreenCanvas) {
            return new OffscreenCanvas(width, height);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }

    function throttle(func, ms) {

        var isThrottled = false,
            savedArgs,
            savedThis;

        function wrapper() {

            if (isThrottled) { // (2)
                savedArgs = arguments;
                savedThis = this;
                return;
            }

            func.apply(this, arguments); // (1)

            isThrottled = true;

            setTimeout(function () {
                isThrottled = false; // (3)
                if (savedArgs) {
                    wrapper.apply(savedThis, savedArgs);
                    savedArgs = savedThis = null;
                }
            }, ms);
        }

        return wrapper;
    }

    function mergeDeep(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();

        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                if (isObject(source[key])) {
                    if (!target[key]) target[key] = {};
                    mergeDeep(target[key], source[key]);
                } else {
                    Object.assign(target, {[key]: source[key]});
                }
            }
        }

        return mergeDeep(target, ...sources);
    }

    function binaryIndexSearch(arr, valExtractor, val, left, right) {
        if (val < valExtractor(arr[left])) {
            return left;
        }
        if (val > valExtractor(arr[right])) {
            return right;
        }
        let lo = left, hi = right;
        while (lo <= hi) {
            const mid = lo + ((hi - lo) >> 1);
            if (val < valExtractor(arr[mid])) {
                hi = mid - 1;
            } else if (val > valExtractor(arr[mid])) {
                lo = mid + 1;
            } else {
                return mid;
            }
        }
        return (valExtractor(arr[lo]) - val) < (val - valExtractor(arr[hi])) ? lo : hi;
    }

    /**
     * Returns scale object that allows us to convert coordinates between domain coordinates to screen one
     * @param _domain
     * @param _range
     * @returns {{invert: (function(*): number), domain: domain, range: range, convert: (function(*): number)}}
     */
    function scaleLinear(_domain = [0, 0], _range = [0, 0]) {
        function domain(_newDomain) {
            if (_newDomain) {
                _domain = _newDomain;
                return this;
            }
            return _domain;

        }

        function range(_newRange) {
            if (_newRange) {
                _range = _newRange;
                return this;
            }
            return _range;

        }

        return {
            convert: val => (_domain[1] === _domain[0]) ? 0 : ((val - _domain[0]) * (_range[1] - _range[0]) / (_domain[1] - _domain[0]) + _range[0]),
            invert: val => (_range[1] === _range[0]) ? 0 : ((val - _range[0]) * (_domain[1] - _domain[0]) / (_range[1] - _range[0]) + _domain[0]),
            range,
            domain
        }
    }

    function format(val, formatter) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        const date = new Date(val);
        return `${monthNames[date.getMonth()]} ${date.getDate()}`;
    }

    return {
        scaleLinear,
        format,
        throttle,
        createOffscreenCanvas,
        binaryIndexSearch,
        mergeDeep
    }
})();

const App = (function app() {
    const DAY_MODE = 0;
    const NIGHT_MODE = 1;
    let currentMode = DAY_MODE;
    let charts = [];

    function init() {
        loadJSON();
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('tooltipshow', onTooltipShow);
    window.addEventListener('tooltiphide', onTooltipHide);
    function loadJSON() {
        fetch('chart_data.json').then(data => {
            return data.json();
        }).then(data => {
            const content = document.getElementById('content');
            data.map((d, i) =>

                [d, `    
        <span class="chart-title">Chart ${i}</span>
        <div class="canvas-wrapper">
        
        </div>
       <div class="x-range-slider">
           
        </div>
        <div class="legend">
        </div>
         
           `]
            ).forEach(([d, html], i) => {
                const div = document.createElement('div');
                div.classList.add('chart-container');
                div.innerHTML = html;
                content.appendChild(div);
                charts.push(new LineChart(div.getElementsByClassName('canvas-wrapper')[0], d, i));
            });
            render();
        });
    };

    class LineChart {


        constructor(container, data, id, config) {
            this.showAnimationIds = [];
            this.hideAnimationIds = [];
            this.hideSliderImageAnimationIds = [];
            this.showSliderImageAnimationIds = [];
            this.disabledSeries = new Set();
            this.defaultConfig = {
                chart: {
                    padding: {left: 0, right: 0, top: 50, bottom: 50},
                    tooltip: (pts) => {
                        return ` 
                        <span class="tooltip-x-value">${Utils.format(pts[0].x, this.config.axis.x.labels.format)}</span><br>
                        <div class="tooltip-values">
                            ${pts.map(pt => `<div class="tooltip-value" style="color:${pt.color}">
                            <span class="tooltip-series-value">${pt.y}</span>
                            <span class="tooltip-series-name">${pt.name}</span>
                            </div>`).join('')}
                       
                        </div>
                        
                        `
                    },
                    fill: '#fff'
                },
                axis: {
                    y: {ticks: 5, labels: {color: '#9aa6ad'}, stroke: '#ddd'},
                    x: {
                        ticks: 6, labels: {format: 'MM d', color: '#a6b0b7'}
                    }
                }
            };
            this.id = id;
            this.container = container;
            this.data = {names: [], colors: [], columns: []};
            const xColumn = Object.keys(data.types).find(a => a[0] === 'x');
            const yColumns = Object.keys(data.types).filter(a => a[0] !== 'x');
            this.data.columns[0] = data.columns.find(colData => colData[0] === xColumn).slice(1);
            this.xRange = [0, this.data.columns[0].length - 1];
            this.lineCanvasArray = [];
            this.sliderImageCanvasArray = [];
            yColumns.forEach((yCol, i) => {
                this.data.names.push(data.names[yCol]);
                this.data.colors.push(data.colors[yCol]);
                this.data.columns[i + 1] = data.columns.find(colData => colData[0] === yCol).slice(1);
                this.lineCanvasArray.push(document.createElement('canvas'));
                this.sliderImageCanvasArray.push(document.createElement('canvas'));

            });

            this.config = this.defaultConfig;
            this.selectedPoints = [];
            this.yAnimations = [];
            this.xAnimations = [];
            this.chartAnimations = [];
            this.sliderImageAnimations = [];
            Utils.mergeDeep(this.config, config);
            const rect = this.container.getBoundingClientRect();
            this.lineCanvasArray.forEach(c => {
                c.width = rect.width;
                c.height = rect.height;
                this.container.appendChild(c);
            });


            const mouseHelperCanvas = this.mouseHelperCanvas = document.createElement('canvas');
            this.container.appendChild(mouseHelperCanvas);
            this.width = mouseHelperCanvas.width = rect.width;
            this.height = mouseHelperCanvas.height = rect.height;
            const xaxisCanvas = this.xaxisCanvas = document.createElement('canvas');
            const yaxisCanvas = this.yaxisCanvas = document.createElement('canvas');
            xaxisCanvas.width = yaxisCanvas.width = rect.width;
            xaxisCanvas.height = yaxisCanvas.height = rect.height;
            this.container.prepend(xaxisCanvas, yaxisCanvas);
            this.initListeners();
            this.initLegend();
            this.initSlider();

        }

        initListeners() {
            this.container.addEventListener('mousemove', evt => {
                this.onMouseMove(evt);
            });
            this.container.addEventListener('touchmove', evt => {
                this.onMouseMove(evt);
            });
            this.container.addEventListener('mouseleave', evt => {
                this.onMouseLeave(evt);
            })
        }

        setConfig(config) {
            Utils.mergeDeep(this.config, config);
            this.needRedraw = true;
            this.render();
        }

        onResize() {
            const rect = this.container.getBoundingClientRect();
            this.lineCanvasArray.forEach(c => {
                c.width = rect.width;
                c.height = rect.height;
            });
            this.width = this.yaxisCanvas.width = this.xaxisCanvas.width = this.mouseHelperCanvas.width = rect.width;
            this.height = this.yaxisCanvas.height = this.xaxisCanvas.height = this.mouseHelperCanvas.height = rect.height;
            this.needRedraw = true;
            this.render();
        }

        /**
         * To allow throttling rendering
         */
        _render() {

            this.drawAxis();
            this.drawChart();
            this.drawChart(true);
            this.renderSelectedPoints();
            this.needRedraw = false;
        }

        render() {
            this.initScales();
            this._render();
        }

        initScales() {
            let yExtent = this.findExtents();
            if (yExtent.max === Number.MIN_VALUE && yExtent.min === Number.MAX_VALUE) {
                yExtent = {max: 100, min: 0};
            }
            const yTicks = this.config.axis.y.ticks;
            const ystep = Math.ceil(yExtent.max / yTicks);
            const maxY = ystep * yTicks;
            this.config.prevScaleY = this.config.scaleY;

            this.config.scaleY = Utils.scaleLinear([0, maxY], [this.height -
            this.config.chart.padding.bottom, 50]);
            this.config.prevSliderImageScaleY = this.config.sliderImageScaleY;
            this.config.sliderImageScaleY = Utils.scaleLinear([0, this.findExtents(true).max], [this.sliderImageCanvasArray[0].height -
            0, 0]);

            const data = this.data.columns[0];
            const xExtent = [data[this.xRange[0]], data[this.xRange[1]]];

            this.config.prevScaleX = this.config.scaleX;
            this.config.scaleX = Utils.scaleLinear([xExtent[0], xExtent[1]],
                [this.config.chart.padding.left,
                    this.width - this.config.chart.padding.right]);
            this.config.sliderImageScaleX = Utils.scaleLinear([data[0], data[data.length - 1]],
                [0,
                    this.sliderImageCanvasArray[0].width]);

        }

        drawYAxis() {
            const yTicks = this.config.axis.y.ticks;
            if (this.config.prevScaleY && this.config.prevScaleY.domain()[1] === this.config.scaleY.domain()[1]
                && !this.needRedraw) {
                return;
            }
            const scaleY = this.config.scaleY;
            const step = Math.ceil(this.config.scaleY.domain()[1] / yTicks);
            const newYAxisCanvas =
                document.createElement('canvas');
            newYAxisCanvas.width = this.yaxisCanvas.width;
            newYAxisCanvas.height = this.yaxisCanvas.height;
            const ctx = newYAxisCanvas.getContext('2d');
            ctx.lineWidth = 1;
            ctx.font = '1.2em Arial';
            ctx.fillStyle = this.config.axis.y.labels.color;
            ctx.strokeStyle = this.config.axis.y.stroke;
            for (let i = 0; i <= yTicks; i++) {
                const screenY = scaleY.convert(step * i);

                ctx.beginPath();
                ctx.moveTo(0, screenY);
                ctx.lineTo(this.width - this.config.chart.padding.right, screenY);

                ctx.fillText(step * i, 0, screenY - 5);

                ctx.stroke();
            }


            if (!this.config.prevScaleY || this.needRedraw) {
                this.yaxisCanvas.width = this.yaxisCanvas.width;
                this.yaxisCanvas.getContext('2d').drawImage(newYAxisCanvas, 0, 0);
            } else {
                const prevDomainMax = this.config.prevScaleY.domain()[1];
                const curDomainMax = this.config.scaleY.domain()[1];
                this.yAnimations.forEach(anim => anim.stop());
                this.yAnimations = [];
                this.container.prepend(newYAxisCanvas);
                newYAxisCanvas.style.opacity = 0;
                this.yAnimations.push(this.animate(350, 0, (passed, duration) => {
                    this.yaxisCanvas.style.opacity = 1 - passed / duration;
                    if (prevDomainMax < curDomainMax) {
                        this.yaxisCanvas.style.transform = `translate(0, ${40 * (passed / duration)}%) scale(1, ${1 - passed / duration})`;
                    } else {
                        this.yaxisCanvas.style.transform = `translate(0, ${(-40 * passed / duration)}%) scale(1, ${1 - passed / duration})`;
                    }

                }));
                let newYAxisAnimation = this.animate(350, 0, (passed, duration) => {
                    newYAxisCanvas.style.opacity = passed / duration;
                    if (prevDomainMax < curDomainMax) {
                        newYAxisCanvas.style.transform = `translate(0, ${-50 + 50 * (passed / duration)}%) scale(1, ${passed / duration})`;
                    } else {
                        newYAxisCanvas.style.transform = `translate(0, ${40 - 40 * (passed / duration)}%) scale(1, ${passed / duration})`;
                    }
                });
                this.yAnimations.push(newYAxisAnimation);
                newYAxisAnimation.onEnd(() => {
                    newYAxisCanvas.style.opacity = 1;
                    newYAxisCanvas.style.transform = 'none';
                    this.yaxisCanvas.style.opacity = 1;
                    this.yaxisCanvas.style.transform = 'none';
                    this.yaxisCanvas.width = this.yaxisCanvas.width;


                    this.yaxisCanvas.getContext('2d').drawImage(newYAxisCanvas, 0, 0);
                    this.yaxisCanvas.style.opacity = 1;
                    this.container.removeChild(newYAxisCanvas);
                });
            }


        }

        canvasAnimate(canvas, duration, delay, cb) {
            const animationCanvas = Utils.createOffscreenCanvas(canvas.width, canvas.height);
            animationCanvas.getContext('2d').drawImage(canvas, 0, 0);
            const ctx = canvas.getContext('2d');
            return this.animate(duration, delay, (passed, duration) => {
                animationCanvas.getContext('2d').save();
                cb && cb(animationCanvas.getContext('2d'), passed, duration);
                animationCanvas.getContext('2d').restore();
                canvas.width = canvas.width;
                ctx.drawImage(animationCanvas, 0, 0);
                animationCanvas.width = animationCanvas.width;
            });
        }

        animate(duration, delay, cb) {
            let startTime = Date.now();
            const that = this;
            let stopped = false;
            let onEndCb;


            function animation() {
                const now = Date.now();
                if (stopped || now - startTime - delay > duration) {
                    onEndCb && onEndCb();
                    return;
                }
                if (now - startTime >= delay) {


                    cb && cb(now - startTime - delay, duration);

                }
                requestAnimationFrame(animation);
                //

            }

            function onEnd(cb) {
                onEndCb = cb;
            }

            function stop() {
                stopped = true;
            }

            animation();
            return {
                onEnd,
                stop
            }
        }

        drawXAxis() {
            const data = this.data.columns[0];
            const newXAxisCanvas =
                document.createElement('canvas');
            newXAxisCanvas.width = this.yaxisCanvas.width;
            newXAxisCanvas.height = this.yaxisCanvas.height;
            const scaleX = this.config.scaleX;
            const ctx = newXAxisCanvas.getContext('2d');
            ctx.lineWidth = 1;
            ctx.font = '1.2em Arial';
            ctx.miterLimit = 1;
            ctx.textAlign = "center";

            const xTicks = this.config.axis.x.ticks;
            const step = Math.ceil((data[this.xRange[1]] - data[this.xRange[0]]) / xTicks);
            ctx.fillStyle = this.config.axis.x.labels.color;
            for (let i = 1; i < xTicks; i++) {

                const screenX = scaleX.convert(data[this.xRange[0]] + step * i);
                ctx.fillText(Utils.format(data[this.xRange[0]] + step * i, this.config.axis.x.labels.format), screenX, this.height - 30);
            }
            debugger;
            if (!this.config.prevScaleX || this.needRedraw
                || this.config.prevScaleX.domain()[1] === this.config.scaleX.domain()[1]
                && this.config.prevScaleX.domain()[0] === this.config.scaleX.domain()[0]) {
                this.xaxisCanvas.width = this.xaxisCanvas.width;
                this.xaxisCanvas.getContext('2d').drawImage(newXAxisCanvas, 0, 0);
            } else {
                const prevDomainMax = this.config.prevScaleX.domain()[1];
                const curDomainMax = this.config.scaleX.domain()[1];
                this.xAnimations.forEach(anim => anim.stop());
                this.xAnimations = [];
                this.container.prepend(newXAxisCanvas);
                newXAxisCanvas.style.opacity = 0;
                this.xAnimations.push(this.animate(500, 0, (passed, duration) => {
                    this.xaxisCanvas.style.opacity = 0.3 - 0.3 * passed / duration;
                    if (prevDomainMax > curDomainMax) {
                        this.xaxisCanvas.style.transform = `translate(${40 * (passed / duration)}%, 0) scale(${1 - passed / duration}, 1)`;
                    } else {
                        this.xaxisCanvas.style.transform = `translate(${(-40 * passed / duration)}%, 0) scale( ${1 - passed / duration}, 1)`;
                    }

                }));
                let newXAxisAnimation = this.animate(500, 0, (passed, duration) => {
                    newXAxisCanvas.style.opacity = passed / duration;
                    if (prevDomainMax > curDomainMax) {
                        newXAxisCanvas.style.transform = `translate(${-50 + 50 * (passed / duration)}%, 0) scale(${passed / duration}, 1)`;
                    } else {
                        newXAxisCanvas.style.transform = `translate(${40 - 40 * (passed / duration)}%, 0) scale(${passed / duration}, 1)`;
                    }
                });
                this.xAnimations.push(newXAxisAnimation)
                newXAxisAnimation.onEnd(() => {
                    newXAxisCanvas.style.opacity = 1;
                    newXAxisCanvas.style.transform = 'none';
                    this.xaxisCanvas.style.opacity = 1;
                    this.xaxisCanvas.style.transform = 'none';
                    this.xaxisCanvas.width = this.xaxisCanvas.width;


                    this.xaxisCanvas.getContext('2d').drawImage(newXAxisCanvas, 0, 0);
                    this.xaxisCanvas.style.opacity = 1;
                    this.container.removeChild(newXAxisCanvas);
                });
            }

        }

        drawAxis() {
            this.drawXAxis();
            this.drawYAxis();

        }


        drawChart(isSliderImage) {
            const chartAnimations = isSliderImage ? this.sliderImageAnimations : this.chartAnimations;
            chartAnimations.forEach(anim => anim.stop());
            const showAnimationIds = isSliderImage ? this.showSliderImageAnimationIds : this.showAnimationIds;
            const hideAnimationsIds = isSliderImage ? this.hideSliderImageAnimationIds : this.hideAnimationIds;
            chartAnimations.length = 0;

            function drawLine(ctx, data, scaleX, scaleY, dy) {
                const xs = this.data.columns[0];
                ctx.lineJoin = 'round';
                //
                let curPoint = {}; // used to ignore useless points(points that person couldn't see)
                const leftBoundary = isSliderImage ? 0 : this.xRange[0];
                const rightBoundary = isSliderImage ? data.length - 1 : this.xRange[1];
                for (let i = leftBoundary; i <= rightBoundary; i++) {

                    const val = data[i];


                    const point = [~~scaleX.convert(xs[i]), ~~(scaleY.convert(val * dy))];
                    if (i === leftBoundary) {
                        ctx.beginPath();
                        curPoint = point;
                        ctx.moveTo(...point);

                    } else {
                        if (Math.abs(point[0] - curPoint[0]) < 1 && Math.abs(point[1] - curPoint[1]) < 1) {
                        } else {
                            curPoint = point; // (0 , 100  => 0 60) 50/100*60
                            ctx.lineTo(...point);
                        }
                    }
                    if (i === rightBoundary) {
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }

                }

            }

            const canvasArray = isSliderImage ? this.sliderImageCanvasArray : this.lineCanvasArray;
            canvasArray.forEach((canvas, seriesIndex) => {

                if (!this.disabledSeries.has(seriesIndex)) {
                    const scaleX = isSliderImage ? this.config.sliderImageScaleX : this.config.scaleX;
                    const scaleY = isSliderImage ? this.config.sliderImageScaleY : this.config.scaleY;
                    const prevScaleY = isSliderImage ? this.config.prevSliderImageScaleY : this.config.prevScaleY;
                    if (isSliderImage && prevScaleY && prevScaleY.domain()[1] === scaleY.domain()[1] && !showAnimationIds.includes(seriesIndex)
                        && !showAnimationIds.includes(seriesIndex)) {
                        return;
                    }
                    canvas.style.visibility = 'visible';
                    const newChartCanvas = Utils.createOffscreenCanvas(canvas.width, canvas.height);

                    newChartCanvas.width = canvas.width;
                    newChartCanvas.height = canvas.height;
                    const ctx = newChartCanvas.getContext('2d');

                    const data = this.data.columns[seriesIndex + 1];


                    ctx.strokeStyle = this.data.colors[seriesIndex];
                    if (!prevScaleY ||
                        (prevScaleY.domain()[1] === scaleY.domain()[1] && !showAnimationIds.includes(seriesIndex))) {

                        canvas.width = canvas.width;
                        drawLine.call(this, ctx, data, scaleX, scaleY, 1);
                        canvas.getContext('2d').drawImage(newChartCanvas, 0, 0);
                    } else {

                        const dy = prevScaleY.domain()[1] / scaleY.domain()[1];

                        if (showAnimationIds.includes(seriesIndex)) {


                            const animation = this.animate(350, 0, (passed, duration) => {
                                canvas.style.opacity = passed / duration;

                                if (dy < 1) {
                                    canvas.style.transform = `translate(0, ${-50 + 50 * (passed / duration)}%) scale(1, ${passed / duration})`;
                                } else {

                                    canvas.style.transform = `translate(0, ${(40 - 40 * passed / duration)}%) scale(1, ${passed / duration})`;
                                }

                            });
                            chartAnimations.push(animation);
                            animation.onEnd(() => {
                                canvas.style.transform = 'none';
                                canvas.style.opacity = 1;
                                canvas.style.visibility = 'visible';
                            });
                            showAnimationIds.splice(showAnimationIds.indexOf(seriesIndex));
                        } else {

                            this.canvasAnimate(canvas, 350, 0, (ctx, passed, duration) => {
                                ctx.strokeStyle = this.data.colors[seriesIndex];
                                drawLine.call(this, ctx, data, isSliderImage ? scaleX : this.config.scaleX, prevScaleY, 1 + (dy - 1) * passed / duration);
                            });
                        }

                    }


                } else {
                    if (hideAnimationsIds.indexOf(seriesIndex) !== -1) {
                        hideAnimationsIds.splice(hideAnimationsIds.indexOf(seriesIndex));
                        const dy = this.config.prevScaleY.domain()[1] - this.config.scaleY.domain()[1];

                        let animation = this.animate(350, 0, (passed, duration) => {
                            canvas.style.opacity = 1 - passed / duration;

                            if (dy <= 0) {
                                canvas.style.transform = `translate(0, ${40 * (passed / duration)}%) scale(1, ${1 - 0.9 * passed / duration})`;
                            } else {

                                canvas.style.transform = `translate(0, ${(-40 * passed / duration)}%) scale(1, ${1 - 0.9 * passed / duration})`;
                            }

                        });
                        chartAnimations.push(animation);
                        animation.onEnd(() => {
                            canvas.style.transform = 'none';
                            canvas.style.opacity = 1;
                            canvas.style.visibility = 'hidden';
                        });
                    }
                }
            });
        }


        onMouseMove(evt) {
            const rect = this.container.getBoundingClientRect();
            const realX = this.config.scaleX.invert(evt.clientX - rect.left);
            const xdata = this.data.columns[0];
            const index = Utils
                .binaryIndexSearch(xdata, val => val, realX, this.xRange[0], this.xRange[1]);
            this.selectedPoints = [];
            this.data.columns.forEach((d, i) => {
                if (i !== 0) {
                    i--;
                    if (!this.disabledSeries.has(i)) {
                        this.selectedPoints.push({
                            x: xdata[index],
                            y: d[index],
                            color: this.data.colors[i],
                            name: this.data.names[i]
                        });
                    }
                }
            });
            if (this.selectedPoints.length > 0) {
                dispatchEvent(new CustomEvent('tooltipshow', {
                    detail: {
                        text: this.config.chart.tooltip(this.selectedPoints),
                        x: this.config.scaleX.convert(this.selectedPoints[0].x) + content.scrollLeft + rect.left + 25,
                        y: evt.clientY + content.scrollTop + 25
                    }
                }));
            }
            this.renderSelectedPoints();


        }

        onMouseLeave() {
            dispatchEvent(new CustomEvent('tooltiphide'));
            this.selectedPoints = [];
            this.renderSelectedPoints();
        }

        renderSelectedPoints() {
            this.mouseHelperCanvas.width = this.mouseHelperCanvas.width;
            this.mouseHelperCanvas.height = this.mouseHelperCanvas.height;
            const ctx = this.mouseHelperCanvas.getContext('2d');

            if (this.selectedPoints.length > 0) {
                const x = this.config.scaleX.convert(this.selectedPoints[0].x)
                ctx.lineWidth = 2;
                ctx.strokeStyle = this.config.axis.y.stroke;
                ctx.beginPath();
                ctx.moveTo(x, this.config.scaleY.convert(0));
                ctx.lineTo(x, this.mouseHelperCanvas.height - this.config.scaleY.convert(0));
                ctx.stroke();
                this.selectedPoints.forEach(pt => {
                    ctx.beginPath();
                    ctx.arc(x, this.config.scaleY.convert(pt.y), 5, 10, 0, 2 * Math.PI);
                    ctx.strokeStyle = pt.color;
                    ctx.lineWidth = 5;
                    ctx.fillStyle = this.config.chart.fill;
                    ctx.stroke();
                    ctx.fill();
                });

            }
        }


        initLegend() {
            const legendContainer = this.container.parentNode.getElementsByClassName('legend')[0];
            if (legendContainer) {
                legendContainer.innerHTML = this.data.names.map((name, i) => {

                    return `
                    <label class="legend-item item-${this.id}">${name}
                    <input type="checkbox" checked="checked">
                    <span class="checkmark"></span>
                    </label>
                `
                }).join('\n');
                legendContainer.querySelectorAll('.legend-item input[type="checkbox"]')
                    .forEach((chb, i) =>
                        chb.addEventListener('change', () => {
                            this.invertSeriesEnable(i);
                            this.render();
                        }));
            }
            if (this.legendStyles) {
                document.getElementsByTagName('head')[0].removeChild(this.legendStyles);
            }
            this.legendStyles = document.createElement('style');
            this.legendStyles.type = 'text/css';
            this.legendStyles.innerHTML = this.data.colors.map((color, i) => `
                .legend-item:nth-child(${i + 1}).item-${this.id} input:checked ~ .checkmark {
                    background-color: ${color};
                }`).join('\n');
            document.getElementsByTagName('head')[0].appendChild(this.legendStyles);


        }

        findExtents(forSliderImage) {
            return this.data.columns

                .reduce((acc, series, i) => {
                    if (i > 0 && !this.disabledSeries.has(i - 1)) {
                        const {min, max} = series.filter((d, i) => forSliderImage || i >= this.xRange[0] && i <= this.xRange[1]).reduce((acc, value) => {
                            acc.min = Math.min(acc.min, value);
                            acc.max = Math.max(acc.max, value);
                            return acc;
                        }, {min: Number.MAX_VALUE, max: Number.MIN_VALUE});
                        acc.min = Math.min(acc.min, min);
                        acc.max = Math.max(acc.max, max);
                    }
                    return acc;
                }, {min: Number.MAX_VALUE, max: Number.MIN_VALUE});
        }

        // if max [a,b]
        initSlider() {
            const sliderContainer = this.container.parentNode.getElementsByClassName('x-range-slider')[0];
            sliderContainer.innerHTML = `
                <div class="slider-area"></div>
                <input type="range" class="slider" value="0" min="0" max="100">
                <input type="range" class="slider" value="100" min="0" max="100">
                <div class="range"></div>
            `;
            const bbox = sliderContainer.getBoundingClientRect();

            this.sliderImageCanvasArray.forEach(c => {
                c.width = bbox.width;
                c.height = bbox.height;
                sliderContainer.prepend(c);
            });

            this.sliderScale = Utils.scaleLinear([0, 100], [0, this.data.columns[0].length - 1]);
            const range = sliderContainer.getElementsByClassName('range')[0];
            let rangeDragging = false;
            const sliders = [...sliderContainer.getElementsByClassName('slider')]
            let startX = 0;
            if (this.sliderImageCanvasArray.length > 0) {
                this.sliderImageCanvasArray[0].addEventListener('touchstart', evt => {
                    rangeDragging = true;
                    startX = evt.touches[0].clientX;
                }, {capture: true});
                this.sliderImageCanvasArray[0].addEventListener('mousedown', evt => {
                    rangeDragging = true;
                    startX = evt.clientX;
                }, {capture: true});
            }

            function dragging(evt) {
                if (rangeDragging) {
                    const dx = Math.floor((evt.clientX - startX) * 100 / sliderContainer.offsetWidth);
                    if (Math.abs(dx) >= 1) {
                        startX = evt.clientX;
                        const values = sliders.map(slider => +slider.value)
                        values.sort((a, b) => a - b);
                        if ((values[1] < 100 || dx < 0) && (values[0] > 0 || dx > 0)) {
                            if (values[1] + dx > 100) {
                                values[0] += 100 - values[1];
                                values[1] = 100;
                            } else if (values[0] + dx < 0) {
                                values[1] -= values[0];
                                values[0] = 0;
                            } else {
                                values[0] += dx;
                                values[1] += dx;
                            }
                            values.forEach((d, i) => sliders[i].value = d);
                            range.style.left = values[0] + '%';
                            range.style.width = values[1] - values[0] + '%';
                            this.xRange = values.map(this.sliderScale.convert).map(Math.floor);
                            this.render();
                        }
                    }


                }
            }

            window.addEventListener('mousemove', (evt) => {
                dragging.call(this, evt);
            });
            window.addEventListener('touchmove', (evt) => {
                dragging.call(this, {clientX: evt.touches[0].clientX, clientY: evt.touches[0].clientY});
            });

            function dragEnd() {
                rangeDragging = false;
            }

            window.addEventListener('touchend', dragEnd);
            window.addEventListener('mouseup', dragEnd);
            const sliderThrottle = Utils.throttle(() => {
                const values = sliders.map(slider => slider.value);
                values.sort((a, b) => a - b);
                range.style.left = values[0] + '%';
                range.style.width = values[1] - values[0] + '%';
                this.xRange = values.map(this.sliderScale.convert).map(Math.floor);
                this.render();
            }, 10);
            sliders.forEach((elem, i) => {
                elem.addEventListener('input', sliderThrottle);
            });
            let down = false;

        }


        invertSeriesEnable(i) {
            if (this.disabledSeries.has(i)) {
                this.showAnimationIds.push(i);
                this.showSliderImageAnimationIds.push(i);
                this.disabledSeries.delete(i);
            } else {
                this.hideAnimationIds.push(i);
                this.hideSliderImageAnimationIds.push(i);
                this.disabledSeries.add(i);
            }
        }
    }

    function onTooltipShow(evt) {
        let dx = '0';
        let dy = '0';
        if (evt.detail.x - content.scrollLeft > window.innerWidth / 2) {
            evt.detail.x -= 50;
            dx = '-100%';
        }
        if (evt.detail.y - content.scrollTop > window.innerHeight / 2) {
            dy = '-100%';
            evt.detail.y -= 50;
        }
        tooltip.style.left = evt.detail.x + 'px';
        tooltip.style.display = 'flex';
        tooltip.style.transform = `translate(${dx},${dy})`;
        tooltip.style.top = evt.detail.y + 'px';
        tooltip.innerHTML = evt.detail.text;
    }

    function onTooltipHide(evt) {
        tooltip.style.display = 'none';
    }

    function onResize() {
        charts.forEach(chart => chart.onResize());
    }

    function render() {
        charts.forEach(chart => chart.render());
    }

    function switchMode(evt) {
        if (currentMode === DAY_MODE) {
            currentMode = NIGHT_MODE;
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            evt.target.innerText = 'Switch to Day Mode';
        } else {
            currentMode = DAY_MODE;
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            evt.target.innerText = 'Switch to Night Mode';
        }
        charts.forEach(chart => {
                let config = {
                    chart: {fill: '#fff'},
                    axis: {
                        y: {labels: {color: '#9aa6ad'}, stroke: '#ddd'},
                        x: {
                            color: '#a6b0b7'
                        }
                    }
                };
                if (currentMode === NIGHT_MODE) {
                    config = {
                        chart: {fill: '#242f3e'},
                        axis: {
                            y: {labels: {color: '#516374'}, stroke: '#343f4e'},
                            x: {
                                labels: {color: '#516374'}
                            }
                        }
                    }
                }
                chart.setConfig(config);
            }
        )

    }


    return {
        init,
        switchMode
    }
})
();

App.init();

