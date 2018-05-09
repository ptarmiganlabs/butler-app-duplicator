
var d = [];
var s;

var duplicatorService = 'https://localhost:8001';

var app = new Vue({
    el: "#app",
    // validator: null, // private reference
    data: {
        app: {
            error: false
        },
        isCreatingApp: false,
        showAppCreated: false,
        selected: "",
        options: d,
        newAppOwner: "",
        newAppName: ""
    },
    // define methods under the `methods` object
    methods: {
        createApp: function (event) {
            // `this` inside methods points to the Vue instance

            if(!this.validate())
            {
                return;
            }

            // Save copy of Vue instance for later use
            var vueInstance = this;
            vueInstance.isCreatingApp = true;

            console.log('Selected template app id: ' + this.selected.appId);
            console.log('Onwer of new app: ' + this.newAppOwner);
            console.log('Name of new app: ' + this.newAppName);

            $.getJSON(duplicatorService + '/duplicateKeepScript?templateAppId=' + this.selected.appId + '&appName=' + this.newAppName + '&ownerUserId=' + this.newAppOwner, {}, function (data) {
                console.log('App created');
                console.log(data);

                vueInstance.isCreatingApp = false;

                var msgSuccess = 'Success!  Your new app is available <a href="https://ip.of.server/sense/app/' + data.newAppId + '" target="_blank">here</a>.';
                notie.alert({type: 'success', text: msgSuccess, stay: true });
            });
        },

        toggleAppCreated() { this.showAppCreated = !this.showAppCreated; },

        validate:function()
        {
            this.$validator.validateAll();
            if (this.errors.any()) {
                console.log('The provided data is invalid');
                return false;
            }
            return true;
        }


    },
    computed: {
        modalStyleAppCreated() {
            return this.showAppCreated ? { 'padding-left': '0px;', display: 'block' } : {};
        },

        newAppNameLength: function () {
            return this.newAppName.length;
        },

        newAppOwnerLength: function () {
            return this.newAppOwner.length;
        },

        // True if we have enough data to start duplicating the app
        newAppPropertiesOk: function () {
            // `this` points to the vm instance
            if ((this.newAppOwner.length > 0) && (this.newAppName.length > 0)){
                return true;
            } else {
                return false;
            }
        }
    }
});



// If some kindof Single Sign On (SSO) solution is used, here is a good place to retrieve currently logged 
// in user. Place the username in the ssoUser variable

// Get currently logged in SSO user, if any
var ssoUser = "";


// JQuery helper method getJSON described here: https://api.jquery.com/jquery.getjson/

// Assign handlers immediately after making the request, and remember the jqxhr object for this request
notie.alert({ type: 'info', text: ' <i class="fa fa-spinner fa-spin" style="font-size:24px"></i> Loading app templates....' });

var jqxhr1 = $.getJSON(duplicatorService + '/getTemplateList', {}, function (data) {
    $.each(data, function (index, element) {
        d.push({ value: element.id, text: element.name, description: element.description });
    });

    app.selected = { appId: d[0].value, description: d[0].description };
})
    .done(function () {
        notie.alertHide();
    })
    .fail(function () {
        notie.alert({type: 'error', text: 'Error: Could not retrieve list of templates from Sense server.', time:5 });
    })
    .always(function () {
        // console.log("Done loading templates");
    });

