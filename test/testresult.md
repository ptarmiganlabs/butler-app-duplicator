# TOC
   - [Butler app duplicator for Qlik Sense](#butler-app-duplicator-for-qlik-sense)
<a name=""></a>
 
<a name="butler-app-duplicator-for-qlik-sense"></a>
# Butler app duplicator for Qlik Sense
Get app templates.

```js
request
    .get('/getTemplateList')
    .expect(200)
    .expect('Content-Type', 'application/json')
    .expect('Server', 'Qlik Sense app duplicator')
    .then(function (res) {
        // console.log(res);
        done();
    })
    .catch(function (err) {
        // console.log('err ' + err);
        if (err) return done(err);
        done();
    })
```

Duplicate app (keep load script).

```js
request
    .get('/duplicateKeepScript')
    .query('templateAppId=0311cafa-8d35-4aa3-a85a-ab356627b93e')
    .query('&appName=atest1')
    .query('ownerUserId=goran')
    .expect(200)
    .expect('Content-Type', 'application/json')
    .expect('Server', 'Qlik Sense app duplicator')
    .then(function (res) {
        expect(res.body.result.substr(0, 20)).to.equal('Done duplicating app');
        done();
    })
    .catch(function (err) {
        if (err) return done(err);
        done();
    })
```

Duplicate app (replace load script).

```js
request
    .get('/duplicateNewScript')
    .query('templateAppId=0311cafa-8d35-4aa3-a85a-ab356627b93e')
    .query('&appName=atest2')
    .query('ownerUserId=goran')
    .expect(200)
    .expect('Content-Type', 'application/json')
    .expect('Server', 'Qlik Sense app duplicator')
    .then(function (res) {
        expect(res.body.result.substr(0, 20)).to.equal('Done duplicating app');
        done();
    })
    .catch(function (err) {
        if (err) return done(err);
        done();
    })
```

