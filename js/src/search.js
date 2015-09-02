// tagalong!
var tagalong = require('tagalong');
var formdb = require('formdb');
var querystring = require('querystring');

module.exports = function search() {

  var resultsRoot = document.querySelector('.search-results');
  var form = new formdb.Form('#search-form');
  var query = querystring.parse(location.search.substr(1));

  // the current outbound request
  var req;

  var previousParams = query || {};
  var poppingState = false;

  // "incremental" updates will only hide the list of schools, and
  // not any of the other elements (results total, sort, pages)
  var incremental = false;

  // if this flag is set to false, the search form will not resubmit
  var submit = true;

  // the maximum # of page links to show
  var MAX_PAGES = 6;

  var change = picc.debounce(onChange, 100);

  // get a reference to all of the sliders
  var sliders = d3.selectAll('picc-slider');

  picc.ready(function() {
    // console.warn('setting form data...', query);
    // console.log('states:', form.get('state'));
    form.setData(query);
    // console.log('states:', form.getInputsByName('state'), form.get('state'));

    // for each of the sliders
    sliders
      // update them once first, so they don't fire a change event
      .each(updateSlider)
      .on('change', picc.debounce(function() {
        // when the slider changes, update the input with a range value.
        var input = this.querySelector('input');
        if (input) {
          if (this.lower > this.min || this.upper < this.max) {
            // console.log('%d > %d || %d < %d', this.lower, this.min, this.upper, this.max);
            input.value = [this.lower, this.upper].join('..');
          } else {
            // console.log('slider range @ limits:', this);
            input.value = '';
          }
          change();
        }
      }, 200));

    change();
  });

  form.on('change', change);

  // sort is an "incremental" update
  form.on('change:sort', function() {
    // console.log('change sort!');
    incremental = true;
  });

  // update the distance field's disabled flag when zip changes
  form.on('change:zip', updateDistanceDisabled);

  form.on('change:_drawer', function(value, e) {
    submit = false;
  });

  form.on('submit', function(data, e) {
    change();
    e.preventDefault();
    return false;
  });

  // update the form on popstate
  window.addEventListener('popstate', function(e) {

    // copy the unset keys (as `null`) from the previous state to clear any
    // elements that aren't represented in the new state.
    var state = copyUnsetKeys(previousParams, e.state);
    console.info('pop state:', e.state, '->', state);

    // update all of the form elements
    form.setData(state);

    // update the slider values, too
    sliders.each(updateSlider);

    poppingState = true;
    onChange();
    poppingState = false;
  });

  picc.ui.expandAccordions(function() {
    var inputs = this.querySelectorAll('[name]');
    return [].some.call(inputs, function(input) {
      return query[input.name];
    });
  });

  function onChange() {
    if (!submit) {
      // console.warn('not submitting this time!');
      submit = true;
      return;
    }

    updateDistanceDisabled();

    var params = form.getData();
    for (var k in params) {
      if (Array.isArray(params[k]) && !params[k][0]) {
        // console.warn('ignoring empty array parameter:', k, params[k]);
        delete params[k];
      }
    }

    // don't submit the _drawer parameter
    delete params._drawer;

    var query = picc.form.prepareParams(params);

    // only get open schools
    query[picc.fields.OPERATING] = 1;

    // only query the fields that we care about
    query.fields = [
      // we need the id to link it
      picc.fields.ID,
      // basic display fields
      picc.fields.NAME,
      picc.fields.CITY,
      picc.fields.STATE,
      picc.fields.SIZE,
      // to get "public" or "private"
      picc.fields.OWNERSHIP,
      // to get the "four_year" or "lt_four_year" bit
      picc.fields.PREDOMINANT_DEGREE,
      // get all of the net price values
      picc.fields.NET_PRICE,
      // completion rate
      picc.fields.COMPLETION_RATE,
      // this has no sub-fields
      picc.fields.MEDIAN_EARNINGS,
      // not sure if we need this, but let's get it anyway
      picc.fields.EARNINGS_GT_25K,
      // under investigation flag
      picc.fields.UNDER_INVESTIGATION
    ].join(',');

    var qs = querystring.stringify(params);
    qs = '?' + qs.replace(/^&+/, '')
      .replace(/&{2,}/g, '&')
      .replace(/%3A/g, ':');

    if (poppingState) {
      console.info('popping state');
      history.replaceState(params, 'search', qs);
    } else if (location.search && diff(previousParams, params)) {
      console.info('push state:', qs, previousParams, '->', params);
      // update the URL
      history.pushState(params, 'search', qs);
    } else {
      console.info('replace state:', qs);
      history.replaceState(params, 'search', qs);
    }

    previousParams = params;

    d3.select('a.results-share')
      .attr('href', function() {
        return picc.template.resolve(
          this.getAttribute('data-href'),
          {url: encodeURIComponent(document.location.href)}
        );
      });

    if (req) req.abort();

    var list = d3.select(resultsRoot)
      .select('[data-bind="results"]');

    if (incremental) {
      list.classed('hidden', true);
    } else {
      resultsRoot.classList.add('js-loading');
      resultsRoot.classList.remove('js-loaded');
      resultsRoot.classList.remove('js-error');
    }

    var paginator = resultsRoot.querySelector('.pagination');
    paginator.classList.toggle('show-loading', incremental);

    console.time && console.time('[load]');

    req = picc.API.search(query, function(error, data) {
      resultsRoot.classList.remove('js-loading');
      list.classed('hidden', false);

      paginator.classList.remove('show-loading');
      incremental = false;

      console.timeEnd && console.timeEnd('[load]');

      if (error) {
        resultsRoot.classList.add('js-error');
        return showError(error);
      }

      resultsRoot.classList.add('js-loaded');

      var format = picc.format;

      console.log('loaded schools:', data);

      console.time && console.time('[render]');

      var meta = data.metadata || data;
      // console.log('meta:', meta);
      var total = meta.total;
      var _total = function() { return total; };

      // render the basic DOM template for each school
      tagalong(resultsRoot, data, {
        results_word: format.plural(_total, 'Result'),
        results_total: format.number(_total, '0')
      });

      var page = +params.page || 0;
      var perPage = meta.per_page;

      var pages = getPages(total, perPage, page);

      tagalong(paginator, {
        pages: pages
      }, {
        pages: {
          '@data-index': function(d) {
            return String(d.index);
          },
          '@class': function(d) {
            return d.index === page
              ? 'pagination-page_selected'
              : d.arrow ? 'pagination-arrow' : null;
          },
          link: {
            text: 'page',
            '@data-page': function(d) {
              return String(d.index);
            },
            '@href': function(d) {
              return d.index === page
                ? null
                : d.index === false
                  ? null
                  : '?' + querystring.stringify(picc.data.extend({}, params, {page: d.index}));
            }
          }
        }
      });

      var pageLinks = d3.selectAll('a.select-page')
        .on('click', function() {
          d3.event.preventDefault();

          var _page = this.getAttribute('data-page');
          if (_page === 'false') return;

          pageLinks.each(function() {
            var p = this.getAttribute('data-page');
            var selected = p == _page;
            this.parentNode.classList
              .toggle('pagination-page_selected', selected);
            // console.log('selected?', p, page, selected, '->', this.parentNode);
          });

          form.set('page', _page);
          incremental = true;
          change();
        });

      var resultsList = resultsRoot.querySelector('.schools-list');
      tagalong(resultsList, data.results, picc.school.directives);

      console.timeEnd && console.timeEnd('[render]');
    });
  }

  function getPages(total, perPage, page) {

    var numPages = Math.ceil(total / perPage);
    var previous = false;
    var next = false;

    if (numPages > MAX_PAGES) {
      var end = Math.min(page + MAX_PAGES, numPages);
      var start = end - MAX_PAGES;
      // console.log('pages: %d -> %d', start, end);
      pages = d3.range(start, start + MAX_PAGES);
      previous = start > 0;
      next = end < numPages;
    } else {
      pages = d3.range(0, numPages);
    }

    // console.log('pages:', numPages, '->', pages);

    pages = pages.map(function(page) {
      return {
        page: page + 1,
        index: page
      };
    });

    if (previous) {
      var first = pages[0];
      pages.unshift({
        index: first.index - 1,
        page: '<',
        arrow: true
      });
      if (first.index > 1) {
        pages.unshift({
          index: 0,
          page: '<<',
          arrow: true
        });
      }
    }
    if (next) {
      var last = pages[pages.length - 1];
      pages.push({
        index: last.index + 1,
        page: '>',
        arrow: true
      });
      if (last.index < numPages - 1) {
        pages.push({
          index: numPages - 1,
          page: '>>',
          arrow: true
        });
      }
    }

    return pages;
  }

  function showError(error) {
    console.error('error:', error);
    var message = resultsRoot.querySelector('.error-message');
    error = error.responseText || error;
    message.textContent = String(error) || 'There was an unexpected API error.';
  }

  function diff(a, b) {
    if ((typeof a) !== (typeof b)) {
      // console.log('diff types:', typeof a, typeof b);
      return true;
    } else if (typeof a === 'object') {
      for (k in a) if (diff(a[k], b[k])) return true;
      for (k in b) if (diff(a[k], b[k])) return true;
      return false;
    }
    return a != b;
  }

  function copyUnsetKeys(from, into) {
    var copy = picc.data.extend({}, into);
    for (var key in from) {
      if (!copy.hasOwnProperty(key)) {
        copy[key] = null;
      }
    }
    return copy;
  }


  function updateSlider() {
    // get the value of its hidden input (set by formdb),
    // and parse it as a range
    var input = this.querySelector('input');
    if (input) {
      var value = input.value.split('..').map(Number);
      if (value.length === 2) {
        this.lower = value[0];
        this.upper = value[1];
      } else {
        // console.warn('bad slider input value:', value);
      }
    }
  }

  function updateDistanceDisabled() {
    var zip = form.get('zip');
    var dist = form.getInputsByName('distance')[0];
    if (!dist) return;
    dist.disabled = !zip;
  }

};